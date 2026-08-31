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
  isAdmin,
  tokenFromHeaders,
  UsernameTakenError,
  validateCredentials,
  verifyPassword,
} from "./auth.js";
import { endSession, runTurn } from "./llmProvider.js";
import {
  ELEVENLABS_MODEL_ID,
  GEMINI_MODEL,
  GEMINI_THINKING_LEVEL,
  GEMINI_TTS_MODEL,
  LLM_PROVIDER,
  MODEL,
  MODEL_VISION,
  MURF_API_KEY,
  PORT,
  SMALLESTAI_API_KEY,
  TTS_PROVIDER,
  USERNAME,
} from "./config.js";
import { listCorrections } from "./corrections.js";
import { createEntry, deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import {
  deleteObservation,
  getFoodDbStats,
  getUserObservation,
  listUserObservations,
  normalizeFoodKey,
  recordObservation,
  scaleByQuantity,
  totalFromBasis,
} from "./foods.js";
import { getUsageSummary } from "./usageCost.js";
import { lookupBarcode } from "./openfoodfacts.js";
import {
  createFeedback,
  deleteFeedback,
  getFeedbackAudio,
  getFeedbackText,
  listFeedback,
  listFeedbackForUser,
  setFeedbackResolutionNote,
  setFeedbackStatus,
  setFeedbackTitleSummary,
  setFeedbackTranscript,
} from "./feedback.js";
import { summarizeFeedback } from "./feedbackSummary.js";
import {
  computeTargets,
  getProfile,
  resolveSpeechLang,
  upsertProfile,
  type ProfileUpdateInput,
} from "./profile.js";
import { getDailyStats } from "./stats.js";
import { SttNotConfiguredError, transcribeAudio } from "./sttProvider.js";
import { SMALLESTAI_STT_MODEL } from "./sttSmallest.js";
import { STT_MODEL_ID } from "./stt.js";
import { synthesizeSpeech } from "./ttsProvider.js";
import {
  validateBarcodeEntry,
  validateEntryPatch,
  validateFoodObservation,
  validateProfileInput,
} from "./validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Railway terminates TLS at a proxy — without this, req.ip is the proxy's
// address and per-IP rate limiting would throttle everyone together.
app.set("trust proxy", 1);
app.use(cors());
// Default (100kb) is too small for a feedback report with an inline base64
// voice note attached — raised app-wide rather than per-route since nothing
// else needs anywhere near this much, and rate limiting already bounds abuse.
app.use(express.json({ limit: "15mb" }));

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

app.use(
  [
    "/chat",
    "/entries",
    "/profile",
    "/greeting",
    "/stats",
    "/transcribe",
    "/auth/me",
    "/feedback",
    "/barcode",
    "/synthesize",
    "/foods",
  ],
  requireAuth,
);

// Admin-only routes: requireAuth first (real session), then this. 403s rather
// than 404s — an admin route existing isn't sensitive, only its data is.
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!isAdmin(res.locals.userId as string)) {
    res.status(403).json({ error: "Not authorized." });
    return;
  }
  next();
}
app.use("/admin", requireAuth, requireAdmin);

// Speech-to-text: the client records the user's turn and POSTs the raw audio
// bytes (Content-Type is the recorder's MIME, e.g. audio/mp4 on iOS). Returns
// the transcript, which the client then sends to /chat. express.raw buffers the
// body; the 25MB cap is generous for a short spoken turn.
app.post("/transcribe", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  const audio = req.body as Buffer;
  if (!Buffer.isBuffer(audio) || audio.length === 0) {
    res.status(400).json({ error: "No audio received." });
    return;
  }
  const profile = getProfile(res.locals.userId as string);
  const languageCode = profile?.language === "ro" ? "ro" : profile?.language === "en" ? "en" : undefined;
  try {
    const result = await transcribeAudio(
      audio,
      req.header("content-type") ?? "audio/mp4",
      res.locals.userId as string,
      languageCode,
    );
    res.json({ text: result.text });
  } catch (err) {
    if (err instanceof SttNotConfiguredError) {
      res.status(503).json({ error: "Speech-to-text is not configured on the server." });
      return;
    }
    console.error("[/transcribe] error:", err);
    res.status(502).json({ error: "Could not transcribe the audio. Try again." });
  }
});

app.get("/auth/me", (_req, res) => {
  res.json({ username: res.locals.username as string });
});

// Feedback/bug reports sent from Diagnostics → Send feedback. Everything is
// optional except needing at least a message or a voice note — the log
// snapshot is opt-in and just passed through as a string the frontend already
// formatted (see DiagnosticsPage's diag log).
app.post("/feedback", (req, res) => {
  const { message, audio_base64, audio_mime, log_snapshot } = (req.body ?? {}) as {
    message?: unknown;
    audio_base64?: unknown;
    audio_mime?: unknown;
    log_snapshot?: unknown;
  };
  const text = typeof message === "string" ? message.trim() : "";
  const hasAudio = typeof audio_base64 === "string" && audio_base64.length > 0;
  if (!text && !hasAudio) {
    res.status(400).json({ error: "Add a message or a voice note before sending." });
    return;
  }
  const id = createFeedback(res.locals.userId as string, {
    message: text || null,
    audio_base64: hasAudio ? (audio_base64 as string) : null,
    audio_mime: typeof audio_mime === "string" ? audio_mime : null,
    log_snapshot: typeof log_snapshot === "string" ? log_snapshot : null,
  });
  res.json({ id });
});

// The reporter's own read-only view of what they've sent in — status and,
// once an admin has written one, the resolution note explaining what
// happened. Not admin-gated (it's the user's own data); no fields beyond
// what listFeedbackForUser already scopes down to (see feedback.ts).
app.get("/feedback/mine", (_req, res) => {
  res.json(listFeedbackForUser(res.locals.userId as string));
});

// Read-only snapshot of which provider/model is actually active right now —
// for debugging which stack produced a given reply, since env vars can drift
// from what you remember setting. Reads the same constants every request
// path already uses, so it can't drift from reality on its own.
app.get("/admin/providers", (_req, res) => {
  res.json({
    llm: {
      provider: LLM_PROVIDER,
      model: LLM_PROVIDER === "gemini" ? GEMINI_MODEL : MODEL,
      vision_model: LLM_PROVIDER === "anthropic" ? MODEL_VISION : null,
      thinking_level: LLM_PROVIDER === "gemini" ? GEMINI_THINKING_LEVEL : null,
    },
    tts: {
      // Matches ttsProvider.ts's actual dispatch: Murf Falcon 2 is the
      // default whenever it's configured, the TTS_PROVIDER switch's result
      // only for confirmed Romanian (and as the fallback if Murf is
      // unconfigured or a request to it fails).
      default: {
        provider: MURF_API_KEY ? "murf" : TTS_PROVIDER,
        model: MURF_API_KEY ? "falcon-2" : TTS_PROVIDER === "gemini" ? GEMINI_TTS_MODEL : ELEVENLABS_MODEL_ID,
      },
      romanian: {
        provider: TTS_PROVIDER,
        model: TTS_PROVIDER === "gemini" ? GEMINI_TTS_MODEL : ELEVENLABS_MODEL_ID,
      },
    },
    stt: {
      // Matches sttProvider.ts's actual dispatch: Smallest AI is the default
      // whenever it's configured, ElevenLabs Scribe only for confirmed
      // Romanian (and as the fallback if Smallest AI is unconfigured or a
      // request to it fails).
      default: {
        provider: SMALLESTAI_API_KEY ? "smallestai" : "elevenlabs",
        model: SMALLESTAI_API_KEY ? SMALLESTAI_STT_MODEL : STT_MODEL_ID,
      },
      romanian: {
        provider: "elevenlabs",
        model: STT_MODEL_ID,
      },
    },
  });
});

app.get("/admin/feedback", (_req, res) => {
  res.json(listFeedback());
});

// Audit trail of calorie edits with a reason/evidence — see corrections.ts.
app.get("/admin/corrections", (_req, res) => {
  res.json(listCorrections());
});

// Accepts status and/or resolution_note independently — an admin can leave
// a note without changing status, flip status without a note, or both at
// once. At least one of the two must be present.
app.patch("/admin/feedback/:id", (req, res) => {
  const { status, resolution_note } = req.body as { status?: unknown; resolution_note?: unknown };
  const hasStatus = status !== undefined;
  const hasNote = resolution_note !== undefined;
  if (!hasStatus && !hasNote) {
    res.status(400).json({ error: "Provide status and/or resolution_note." });
    return;
  }
  if (hasStatus && status !== "new" && status !== "reviewed") {
    res.status(400).json({ error: "status must be 'new' or 'reviewed'." });
    return;
  }
  if (hasNote && typeof resolution_note !== "string" && resolution_note !== null) {
    res.status(400).json({ error: "resolution_note must be a string or null." });
    return;
  }
  let ok = true;
  if (hasStatus) ok = setFeedbackStatus(req.params.id, status as "new" | "reviewed") && ok;
  if (hasNote) ok = setFeedbackResolutionNote(req.params.id, resolution_note as string | null) && ok;
  if (!ok) {
    res.status(404).json({ error: "Feedback not found." });
    return;
  }
  res.status(204).end();
});

app.delete("/admin/feedback/:id", (req, res) => {
  const ok = deleteFeedback(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Feedback not found." });
    return;
  }
  res.status(204).end();
});

// Transcribes a feedback report's voice note on demand (via the same
// ElevenLabs Scribe pipeline as live conversation STT) and caches the result,
// so it's readable text instead of audio only Andrei (not Claude) can hear.
// No language hint — Scribe auto-detects, so a Romanian note works the same
// as an English one.
app.post("/admin/feedback/:id/transcribe", async (req, res) => {
  const audio = getFeedbackAudio(req.params.id);
  if (!audio) {
    res.status(404).json({ error: "This report has no voice note." });
    return;
  }
  try {
    const buffer = Buffer.from(audio.audio_base64, "base64");
    // Logged against the admin doing the transcribing, not the reporter —
    // they're the one whose action actually spends the API call.
    const result = await transcribeAudio(buffer, audio.audio_mime ?? "audio/mp4", res.locals.userId as string);
    setFeedbackTranscript(req.params.id, result.text);
    res.json({ transcript: result.text });
  } catch (err) {
    if (err instanceof SttNotConfiguredError) {
      res.status(503).json({ error: "Speech-to-text is not configured on the server." });
      return;
    }
    console.error("[/admin/feedback/:id/transcribe] error:", err);
    res.status(502).json({ error: "Could not transcribe this voice note." });
  }
});

// Generates a short title + one-sentence summary from whatever text a
// report already has (message, or a transcript already produced above) —
// on demand, not automatic on submit, same cost-avoidance reasoning as
// transcription itself. Works for text-only reports too, not just voice
// ones (2026-08-30 backlog item was voice-specific, but the underlying
// "faster triage" value applies equally to a typed report).
app.post("/admin/feedback/:id/summarize", async (req, res) => {
  const text = getFeedbackText(req.params.id);
  if (!text) {
    res.status(400).json({ error: "Nothing to summarize yet — transcribe the voice note first." });
    return;
  }
  const result = await summarizeFeedback(text);
  if (!result) {
    res.status(502).json({ error: "Could not generate a title right now." });
    return;
  }
  setFeedbackTitleSummary(req.params.id, result.title, result.summary);
  res.json(result);
});

const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
// Decoded-size cap on an attached photo — the client resizes before sending
// (see PhotoAttach.tsx), so this is just a defensive ceiling, generous enough
// for that resize target with real headroom.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

app.post("/chat", async (req, res) => {
  const { session_id, user_text, image_base64, image_mime } = req.body as {
    session_id?: string;
    user_text?: string;
    image_base64?: unknown;
    image_mime?: unknown;
  };
  if (!session_id || typeof session_id !== "string" || !user_text || typeof user_text !== "string") {
    res.status(400).json({ error: "session_id and user_text are required" });
    return;
  }

  let image: Parameters<typeof runTurn>[3];
  if (typeof image_base64 === "string" && image_base64.length > 0) {
    if (typeof image_mime !== "string" || !(IMAGE_MEDIA_TYPES as readonly string[]).includes(image_mime)) {
      res.status(400).json({ error: "image_mime must be one of image/jpeg, image/png, image/gif, image/webp." });
      return;
    }
    if (Buffer.byteLength(image_base64, "base64") > MAX_IMAGE_BYTES) {
      res.status(400).json({ error: "Image is too large." });
      return;
    }
    image = { base64: image_base64, mediaType: image_mime as ImageMediaType };
  }

  try {
    const result = await runTurn(session_id, res.locals.userId as string, user_text, image);
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

// Read-only preview so the client can show the product and let the user
// confirm/enter grams before committing an entry.
app.get("/barcode/:code", async (req, res) => {
  const code = req.params.code;
  if (!/^\d{8,14}$/.test(code)) {
    res.status(400).json({ error: "barcode must be 8 to 14 digits" });
    return;
  }
  const product = await lookupBarcode(code);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  res.json(product);
});

// Logs a barcode-scanned product deterministically — no Claude call. Nutrition
// is re-looked-up server-side (the lookup cache makes this ~free) rather than
// trusting client-supplied numbers.
app.post("/barcode/entries", async (req, res) => {
  const validationError = validateBarcodeEntry(req.body ?? {});
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const { barcode, grams } = req.body as { barcode: string; grams: number };
  const product = await lookupBarcode(barcode);
  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const total = totalFromBasis(product.nutrition, "per_100g", grams);
  // Brand-qualified so a specific packaged product never collides with a
  // generic voice-logged key like "yogurt" — but skip the qualifier when the
  // brand is already part of the name (e.g. "Coca-Cola"), a common shape in
  // Open Food Facts data, to avoid "Coca-Cola (Coca-Cola)".
  const brandRedundant =
    product.brand && product.name.toLowerCase().includes(product.brand.toLowerCase());
  const distinctBrand = product.brand && !brandRedundant ? product.brand : null;
  const foodKey = normalizeFoodKey(distinctBrand ? `${distinctBrand} ${product.name}` : product.name);
  const description = distinctBrand ? `${product.name} (${distinctBrand})` : product.name;

  const entry = createEntry(res.locals.userId as string, {
    raw_transcript: `Scanned barcode ${barcode}`,
    description,
    calories: total.calories,
    protein_g: total.protein_g,
    carbs_g: total.carbs_g,
    fat_g: total.fat_g,
    food_key: foodKey,
    grams,
    source: "barcode",
    agreement_count: null,
  });

  // Official label data is authoritative — feed it in at correction strength
  // so a later voice-logged mention of the same product resolves as "yours".
  if (foodKey) {
    recordObservation(res.locals.userId as string, foodKey, "per_100g", product.nutrition, "correction");
  }

  res.json(entry);
});

// The greeting text only changes when the name or language does — no reason
// to pay for a resynthesis (credits + ~300ms) every session. Keyed by
// provider too, not just text — TTS_PROVIDER picks a different voice per
// language internally, and a stale entry from the other provider would
// otherwise get served after flipping the switch.
const greetingAudioCache = new Map<string, { audio_base64: string; audio_mime: string }>();

app.get("/greeting", async (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  // Prefer the profile's display name, then the account's own username, then
  // the generic env fallback — so a freshly registered user is still greeted
  // by name before they've filled in a profile.
  const name = profile?.name ?? (res.locals.username as string) ?? USERNAME;
  const text = profile?.language === "ro" ? `Bună, ${name}!` : `Hello ${name}`;
  const cacheKey = `${TTS_PROVIDER}:${profile?.language ?? "en"}:${text}`;

  let cached = greetingAudioCache.get(cacheKey);
  if (!cached) {
    const result = await synthesizeSpeech(text, profile, res.locals.userId as string);
    if (result.audio_base64) {
      cached = { audio_base64: result.audio_base64, audio_mime: result.audio_mime };
      greetingAudioCache.set(cacheKey, cached);
    }
  }
  res.json({
    text,
    audio_base64: cached?.audio_base64 ?? null,
    audio_mime: cached?.audio_mime ?? "audio/mpeg",
    lang: resolveSpeechLang(profile),
  });
});

// Synthesizes short, server-controlled text through whichever TTS provider
// is active — for local client-side phrases ("Sorry, I didn't catch that",
// and dynamic /chat error messages) that previously always fell back to the
// browser's speechSynthesis regardless of which premium voice was
// configured (2026-08-29 backlog item). Reuses the greeting cache — same
// key shape, same provider/language keying, and canned phrases repeat often
// enough to benefit from it even though most dynamic error text won't hit
// twice. Capped well below a real reply's length; this is for short fixed
// phrases, not general-purpose TTS.
const MAX_SYNTHESIZE_CHARS = 200;
app.post("/synthesize", async (req, res) => {
  const { text } = req.body as { text?: unknown };
  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text is required" });
    return;
  }
  if (text.length > MAX_SYNTHESIZE_CHARS) {
    res.status(400).json({ error: `text must be ${MAX_SYNTHESIZE_CHARS} characters or fewer` });
    return;
  }
  const profile = getProfile(res.locals.userId as string);
  const cacheKey = `${TTS_PROVIDER}:${profile?.language ?? "en"}:${text}`;

  let cached = greetingAudioCache.get(cacheKey);
  if (!cached) {
    const result = await synthesizeSpeech(text, profile, res.locals.userId as string);
    if (result.audio_base64) {
      cached = { audio_base64: result.audio_base64, audio_mime: result.audio_mime };
      greetingAudioCache.set(cacheKey, cached);
    }
  }
  res.json({
    audio_base64: cached?.audio_base64 ?? null,
    audio_mime: cached?.audio_mime ?? "audio/mpeg",
  });
});

app.get("/profile", (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  res.json({ profile, targets: computeTargets(profile) });
});

// Per-day rollups for the Dashboard trends chart. days is clamped to a small
// allowlist; targets come along so the frontend can draw the goal line without
// a second request.
app.get("/stats", (req, res) => {
  const requested = Number(req.query.days);
  const days = [7, 14, 30, 90].includes(requested) ? requested : 7;
  const profile = getProfile(res.locals.userId as string);
  res.json({
    days: getDailyStats(res.locals.userId as string, days),
    targets: computeTargets(profile),
  });
});

app.get("/stats/foods", (_req, res) => {
  res.json(getFoodDbStats(res.locals.userId as string));
});

// In-app cost tracker (2026-08 backlog item) — a rough today/this-month
// estimate of this user's own API spend by provider. See usageCost.ts for
// the reference unit prices and their real, honest imprecision (STT/Gemini
// TTS are byte/char-based approximations, not exact provider-billed units).
app.get("/stats/usage", (_req, res) => {
  res.json(getUsageSummary(res.locals.userId as string));
});

// "My Foods" — view and directly seed/manage your own remembered value for a
// food, rather than only ever shaping it indirectly through logging/editing
// entries (2026-08-27 backlog item).
app.get("/foods/mine", (_req, res) => {
  res.json(listUserObservations(res.locals.userId as string));
});

// Upsert (same food_key -> update, per food_observations' primary key).
// Always recorded as a "correction" — the user is directly asserting their
// own value here, not the model producing an "estimate".
app.put("/foods/mine", (req, res) => {
  const validationError = validateFoodObservation(req.body ?? {});
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }
  const { food_key, basis, calories, protein_g, carbs_g, fat_g } = req.body as {
    food_key: string;
    basis: "per_100g" | "per_item";
    calories: number;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
  };
  const foodKey = normalizeFoodKey(food_key);
  if (!foodKey) {
    res.status(400).json({ error: "food_key must be a non-empty string." });
    return;
  }
  recordObservation(
    res.locals.userId as string,
    foodKey,
    basis,
    { calories, protein_g: protein_g ?? null, carbs_g: carbs_g ?? null, fat_g: fat_g ?? null },
    "correction",
  );
  res.json(listUserObservations(res.locals.userId as string).find((o) => o.food_key === foodKey));
});

app.delete("/foods/mine/:foodKey", (req, res) => {
  const ok = deleteObservation(res.locals.userId as string, req.params.foodKey);
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.status(204).end();
});

// "Log this again" — one tap from the My Foods screen re-logs a remembered
// food without rescanning/re-describing it (2026-08 backlog item, Andrei:
// scanned milk two days running and wanted a faster way to pick it again).
// quantity means grams for a per_100g food, item count for a per_item one —
// see scaleByQuantity. Always logs as "yours": this *is* the user's own
// remembered value, the same provenance an edited entry gets.
app.post("/foods/mine/:foodKey/log", (req, res) => {
  const userId = res.locals.userId as string;
  const observation = getUserObservation(userId, req.params.foodKey);
  if (!observation) {
    res.status(404).json({ error: "You haven't logged this food before." });
    return;
  }
  const { quantity } = (req.body ?? {}) as { quantity?: unknown };
  const qty = typeof quantity === "number" && Number.isFinite(quantity) ? quantity : 1;
  const maxQty = observation.basis === "per_100g" ? 5000 : 50;
  if (qty <= 0 || qty > maxQty) {
    res.status(400).json({ error: `quantity must be a number between 0 and ${maxQty}` });
    return;
  }

  const total = scaleByQuantity(observation.nutrition, observation.basis, qty);
  const entry = createEntry(userId, {
    raw_transcript: "Logged again from My Foods",
    description: req.params.foodKey,
    calories: total.calories,
    protein_g: total.protein_g,
    carbs_g: total.carbs_g,
    fat_g: total.fat_g,
    food_key: req.params.foodKey,
    grams: observation.basis === "per_100g" ? qty : null,
    source: "yours",
    agreement_count: null,
  });
  res.json(entry);
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
