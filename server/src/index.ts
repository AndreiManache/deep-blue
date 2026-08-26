import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSession,
  createUser,
  deleteSession,
  findUser,
  getSessionUser,
  tokenFromHeaders,
  UsernameTakenError,
  validateCredentials,
  verifyPassword,
} from "./auth.js";
import { endSession, runTurn } from "./chat.js";
import { PORT, USERNAME } from "./config.js";
import { deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import {
  computeTargets,
  getProfile,
  resolveSpeechLang,
  resolveVoiceId,
  upsertProfile,
  type ProfileUpdateInput,
} from "./profile.js";
import { synthesizeSpeech } from "./tts.js";
import { validateEntryPatch, validateProfileInput } from "./validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Railway terminates TLS at a proxy — without this, req.ip is the proxy's
// address and per-IP rate limiting would throttle everyone together.
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

// Tiny fixed-window rate limiter — no dependency needed at this scale.
function makeRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, h] of hits) {
      if (now - h.windowStart > windowMs) hits.delete(ip);
    }
  }, windowMs).unref();
  return function hit(ip: string): boolean {
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.windowStart > windowMs) {
      hits.set(ip, { count: 1, windowStart: now });
      return false;
    }
    h.count++;
    return h.count > limit;
  };
}

// Loose overall ceiling — generous for a handful of trusted people.
const apiOverLimit = makeRateLimiter(120, 60_000);
// Tight budget for wrong login attempts per IP — slows password guessing
// against the /auth/login endpoint.
const failedAuthOverLimit = makeRateLimiter(10, 15 * 60_000);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Shared per-IP throttle used by both the auth endpoints and the gated data
// API — an early return, so a flood can't even reach account lookup or the model.
function rateLimited(req: Request, res: Response): boolean {
  if (apiOverLimit(req.ip ?? "unknown")) {
    res.status(429).json({ error: "Too many requests — slow down a little." });
    return true;
  }
  return false;
}

// Resolves the bearer session token to a user and stores the identity on
// res.locals for downstream handlers. Gates the data API only, never the
// static app shell below, since a plain page navigation can't attach a
// header — the frontend's login screen obtains a token before making any of
// these calls, and a 401 here sends it back to that screen.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (rateLimited(req, res)) return;
  const token = tokenFromHeaders(req.header("authorization"), req.header("x-session-token"));
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Not signed in" });
    return;
  }
  res.locals.userId = user.id;
  res.locals.username = user.username;
  next();
}

// --- auth endpoints (public; obtain or discard a session token) ------------

app.post("/auth/register", (req, res) => {
  if (rateLimited(req, res)) return;
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  const invalid = validateCredentials(username, password);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  try {
    const user = createUser(username as string, password as string);
    const token = createSession(user.id);
    res.json({ token, username: user.username });
  } catch (err) {
    if (err instanceof UsernameTakenError) {
      res.status(409).json({ error: err.message });
      return;
    }
    console.error("[/auth/register] error:", err);
    res.status(500).json({ error: "Could not create the account. Try again." });
  }
});

app.post("/auth/login", (req, res) => {
  if (rateLimited(req, res)) return;
  const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required." });
    return;
  }
  const user = findUser(username);
  // One generic message and one code for both "no such user" and "wrong
  // password", so the endpoint never reveals which usernames exist. Every
  // failure is metered so the short-lived guess budget applies here too.
  if (!user || !verifyPassword(password, user.password_hash)) {
    if (failedAuthOverLimit(req.ip ?? "unknown")) {
      res.status(429).json({ error: "Too many attempts — try again later." });
      return;
    }
    res.status(401).json({ error: "Wrong username or password." });
    return;
  }
  const token = createSession(user.id);
  res.json({ token, username: user.username });
});

app.post("/auth/logout", (req, res) => {
  deleteSession(tokenFromHeaders(req.header("authorization"), req.header("x-session-token")));
  res.status(204).end();
});

app.use(["/chat", "/entries", "/profile", "/greeting", "/auth/me"], requireAuth);

app.get("/auth/me", (_req, res) => {
  res.json({ username: res.locals.username as string });
});

app.post("/chat", async (req, res) => {
  const { session_id, user_text } = req.body as { session_id?: string; user_text?: string };
  if (!session_id || typeof session_id !== "string" || !user_text || typeof user_text !== "string") {
    res.status(400).json({ error: "session_id and user_text are required" });
    return;
  }

  try {
    const result = await runTurn(session_id, res.locals.userId as string, user_text);
    if (result.ended) {
      endSession(session_id);
    }
    res.json(result);
  } catch (err) {
    console.error("[/chat] error:", err);
    res.status(502).json({ error: "Something went wrong talking to the model. Try again." });
  }
});

app.get("/entries", (req, res) => {
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  res.json(getEntriesForDate(res.locals.userId as string, date));
});

app.patch("/entries/:id", (req, res) => {
  const validationError = validateEntryPatch(req.body ?? {});
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const updated = updateEntry(res.locals.userId as string, req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json(updated);
});

app.delete("/entries/:id", (req, res) => {
  const ok = deleteEntry(res.locals.userId as string, req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.status(204).end();
});

// The greeting text only changes when the name or language does — no reason
// to pay ElevenLabs (credits + ~300ms) to re-synthesize it every session.
const greetingAudioCache = new Map<string, string>();

app.get("/greeting", async (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  // Prefer the profile's display name, then the account's own username, then
  // the generic env fallback — so a freshly registered user is still greeted
  // by name before they've filled in a profile.
  const name = profile?.name ?? (res.locals.username as string) ?? USERNAME;
  const text = profile?.language === "ro" ? `Bună, ${name}!` : `Hello ${name}`;
  const voiceId = resolveVoiceId(profile);
  const cacheKey = `${voiceId}:${text}`;

  let audio_base64 = greetingAudioCache.get(cacheKey) ?? null;
  if (!audio_base64) {
    audio_base64 = await synthesizeSpeech(text, voiceId);
    if (audio_base64) greetingAudioCache.set(cacheKey, audio_base64);
  }
  res.json({ text, audio_base64, lang: resolveSpeechLang(profile) });
});

app.get("/profile", (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  res.json({ profile, targets: computeTargets(profile) });
});

app.put("/profile", (req, res) => {
  const validationError = validateProfileInput(req.body ?? {});
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const profile = upsertProfile(res.locals.userId as string, req.body as ProfileUpdateInput);
  res.json({ profile, targets: computeTargets(profile) });
});

// Serves the built frontend when it exists (production/local prod-mode dry
// run). In normal local dev, web/dist doesn't exist, so this is a no-op and
// Vite's own dev server handles the frontend instead.
const WEB_DIST = path.join(__dirname, "..", "..", "web", "dist");
if (fs.existsSync(WEB_DIST)) {
  app.use(express.static(WEB_DIST));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(WEB_DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Deep Blue server listening on http://localhost:${PORT}`);
});
