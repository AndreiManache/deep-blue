import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { endSession, runTurn } from "./chat.js";
import { ACCESS_CODE, PORT } from "./config.js";
import { deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import { computeTargets, getProfile, upsertProfile, type ProfileUpdateInput } from "./profile.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Gates the data API only — never the static app shell below, since a plain
// page navigation can't attach a custom header. The frontend's AccessGate
// prompts for the code before making any of these calls.
function requireAccessCode(req: Request, res: Response, next: NextFunction) {
  if (!ACCESS_CODE) {
    next(); // no code configured — local dev, gate disabled
    return;
  }
  if (req.header("X-Access-Code") !== ACCESS_CODE) {
    res.status(401).json({ error: "Invalid or missing access code" });
    return;
  }
  next();
}

app.use(["/chat", "/entries", "/profile"], requireAccessCode);

app.post("/chat", async (req, res) => {
  const { session_id, user_text } = req.body as { session_id?: string; user_text?: string };
  if (!session_id || typeof session_id !== "string" || !user_text || typeof user_text !== "string") {
    res.status(400).json({ error: "session_id and user_text are required" });
    return;
  }

  try {
    const result = await runTurn(session_id, user_text);
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
  res.json(getEntriesForDate(date));
});

app.patch("/entries/:id", (req, res) => {
  const updated = updateEntry(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.json(updated);
});

app.delete("/entries/:id", (req, res) => {
  const ok = deleteEntry(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.status(204).end();
});

app.get("/profile", (_req, res) => {
  const profile = getProfile();
  res.json({ profile, targets: computeTargets(profile) });
});

app.put("/profile", (req, res) => {
  const profile = upsertProfile(req.body as ProfileUpdateInput);
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
