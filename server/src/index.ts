import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endSession, runTurn } from "./chat.js";
import { ACCESS_CODES, PORT, USERNAME } from "./config.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Resolves the shared access code to a user identity and stores it on
// res.locals for downstream handlers — gates the data API only, never the
// static app shell below, since a plain page navigation can't attach a
// custom header. The frontend's AccessGate prompts for the code before
// making any of these calls.
function resolveUser(req: Request, res: Response, next: NextFunction) {
  if (ACCESS_CODES.size === 0) {
    res.locals.userId = "andrei"; // no codes configured — local dev, gate disabled
    next();
    return;
  }
  const userId = ACCESS_CODES.get(req.header("X-Access-Code") ?? "");
  if (!userId) {
    res.status(401).json({ error: "Invalid or missing access code" });
    return;
  }
  res.locals.userId = userId;
  next();
}

app.use(["/chat", "/entries", "/profile", "/greeting"], resolveUser);

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

app.get("/greeting", async (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  const name = profile?.name ?? USERNAME;
  const text = profile?.language === "ro" ? `Bună, ${name}!` : `Hello ${name}`;
  const audio_base64 = await synthesizeSpeech(text, resolveVoiceId(profile));
  res.json({ text, audio_base64, lang: resolveSpeechLang(profile) });
});

app.get("/profile", (_req, res) => {
  const profile = getProfile(res.locals.userId as string);
  res.json({ profile, targets: computeTargets(profile) });
});

app.put("/profile", (req, res) => {
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
