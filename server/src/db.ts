import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On a host, only a mounted volume survives redeploys — point DEEPBLUE_DB_PATH
// at it there. Defaults to the local dev path otherwise.
const DB_PATH = process.env.DEEPBLUE_DB_PATH ?? path.join(__dirname, "..", "deepblue.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

// Fresh-database shape already includes user_id/language — existing
// databases get there via the migrations below.
db.exec(`
  CREATE TABLE IF NOT EXISTS food_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'andrei',
    raw_transcript TEXT NOT NULL,
    description TEXT NOT NULL,
    calories INTEGER NOT NULL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    created_at TEXT NOT NULL,
    edited INTEGER NOT NULL DEFAULT 0
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_profile (
    id TEXT PRIMARY KEY,
    name TEXT,
    height_cm REAL,
    weight_kg REAL,
    age INTEGER,
    sex TEXT,
    activity_level TEXT,
    goal_type TEXT,
    goal_rate TEXT,
    goal_notes TEXT,
    language TEXT,
    updated_at TEXT NOT NULL
  );
`);

// Migrations below are additive and idempotent — safe to run on every
// startup, local dev and production alike. "ADD COLUMN IF NOT EXISTS" isn't
// supported by the SQLite build node:sqlite bundles here, so existence is
// checked via PRAGMA table_info first.

const entryColumns = db.prepare(`PRAGMA table_info(food_entries)`).all() as { name: string }[];
if (!entryColumns.some((col) => col.name === "user_id")) {
  db.exec(`ALTER TABLE food_entries ADD COLUMN user_id TEXT NOT NULL DEFAULT 'andrei';`);
}

const profileColumns = db.prepare(`PRAGMA table_info(user_profile)`).all() as { name: string; type: string }[];
if (!profileColumns.some((col) => col.name === "language")) {
  db.exec(`ALTER TABLE user_profile ADD COLUMN language TEXT;`);
}

// Original schema had "id INTEGER PRIMARY KEY CHECK (id = 1)" — a hard
// single-user singleton that makes a second profile row impossible. Rebuild
// as a proper per-user table (id = the user's slug) the first time this is
// detected; the CREATE TABLE IF NOT EXISTS above already gives fresh
// databases the new shape directly, so this only ever fires once per
// pre-existing database.
const idColumn = profileColumns.find((col) => col.name === "id");
if (idColumn && idColumn.type.toUpperCase().includes("INT")) {
  db.exec(`
    CREATE TABLE user_profile_v2 (
      id TEXT PRIMARY KEY,
      name TEXT,
      height_cm REAL,
      weight_kg REAL,
      age INTEGER,
      sex TEXT,
      activity_level TEXT,
      goal_type TEXT,
      goal_rate TEXT,
      goal_notes TEXT,
      language TEXT,
      updated_at TEXT NOT NULL
    );
    INSERT INTO user_profile_v2 (id, name, height_cm, weight_kg, age, sex, activity_level, goal_type, goal_rate, goal_notes, language, updated_at)
      SELECT 'andrei', name, height_cm, weight_kg, age, sex, activity_level, goal_type, goal_rate, goal_notes, language, updated_at
      FROM user_profile WHERE id = 1;
    DROP TABLE user_profile;
    ALTER TABLE user_profile_v2 RENAME TO user_profile;
  `);
}

// Real accounts. id is the normalized (lowercase) username, and is the same
// identity string used as user_id across food_entries and user_profile — so a
// person who registers "andrei" inherits any data already logged under that id
// (e.g. from the earlier access-code deployment). username keeps the original
// casing for display; password_hash is a self-contained "salt:hash" scrypt
// string (see auth.ts).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Opaque session tokens issued at login/registration. Kept in the database
// (not memory) so a server restart or Railway redeploy doesn't log everyone
// out. expires_at is an ISO string; expired rows are swept lazily in auth.ts.
db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`);

// --- Food knowledge base (estimation accuracy) ---------------------------

// Each entry now remembers the canonical food it was, the grams logged (when
// known), and where its nutrition came from — so an edit can feed a correction
// back into the knowledge base, and the Dashboard can badge a verified value.
for (const [col, ddl] of [
  ["food_key", "ALTER TABLE food_entries ADD COLUMN food_key TEXT;"],
  ["grams", "ALTER TABLE food_entries ADD COLUMN grams REAL;"],
  // 'estimate' | 'yours' | 'verified'
  ["source", "ALTER TABLE food_entries ADD COLUMN source TEXT;"],
  ["agreement_count", "ALTER TABLE food_entries ADD COLUMN agreement_count INTEGER;"],
] as const) {
  if (!entryColumns.some((c) => c.name === col)) db.exec(ddl);
}

// Feedback/bug reports sent from inside the app (Diagnostics → Send feedback).
// audio_base64 is an optional voice note (small, stored inline like TTS audio
// elsewhere in this codebase); log_snapshot is the JSON-stringified
// diagnostics event log at the time of submission, only when the user opted
// in to attaching it. status lets the admin view mark one triaged.
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    message TEXT,
    audio_base64 TEXT,
    audio_mime TEXT,
    log_snapshot TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new'
  );
`);

// Cached ElevenLabs Scribe transcript of a feedback voice note — transcribed
// on demand from the admin inbox (not automatically on submit, to avoid
// paying for STT on reports nobody ends up needing), then kept so re-opening
// the inbox doesn't re-transcribe.
const feedbackColumns = db.prepare(`PRAGMA table_info(feedback)`).all() as { name: string }[];
if (!feedbackColumns.some((col) => col.name === "transcript")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN transcript TEXT;`);
}
// Set by an admin when closing a report out — surfaced back to the
// reporter on the "My Feedback" screen so they can see what happened to
// what they sent, not just that the inbox marked it "reviewed" (2026-08-29).
if (!feedbackColumns.some((col) => col.name === "resolution_note")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN resolution_note TEXT;`);
}
// LLM-generated (2026-08-30, on-demand from the admin inbox) from the
// report's own message/transcript, purely for faster triage — a report
// still fully works with these null, same degrade-gracefully pattern as
// every optional AI feature in this app.
if (!feedbackColumns.some((col) => col.name === "title")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN title TEXT;`);
}
if (!feedbackColumns.some((col) => col.name === "summary")) {
  db.exec(`ALTER TABLE feedback ADD COLUMN summary TEXT;`);
}

// One nutrition observation per (food_key, user): that user's best value for a
// food, normalized to a basis (per 100g, or per one item when grams are
// unknown). A "correction" (from editing an entry) outranks an "estimate".
// Crowd consensus = enough users' observations for a food_key agreeing; see
// foods.ts. food_key is a canonical lowercase English name the model emits, so
// "butter crackers" and "biscuiți cu unt" collapse to the same food.
db.exec(`
  CREATE TABLE IF NOT EXISTS food_observations (
    food_key TEXT NOT NULL,
    user_id TEXT NOT NULL,
    basis TEXT NOT NULL,        -- 'per_100g' | 'per_item'
    calories REAL NOT NULL,
    protein_g REAL,
    carbs_g REAL,
    fat_g REAL,
    source TEXT NOT NULL,       -- 'estimate' | 'correction'
    updated_at TEXT NOT NULL,
    PRIMARY KEY (food_key, user_id)
  );
`);

// Audit trail for calorie edits (2026-08-27 backlog item: "entry-correction
// capture with reason + evidence"). food_observations already tracks *what*
// a user's corrected value is (feeds the consensus math); this tracks *why*
// a given edit happened, so an admin reviewing the food knowledge base can
// tell a mis-portioned guess from a genuinely ambiguous food from a typo,
// and "5 people agree" can eventually be weighted by how many of those
// corrections actually carried a reason/evidence link. Purely additive —
// doesn't touch food_observations or food_entries.
db.exec(`
  CREATE TABLE IF NOT EXISTS entry_corrections (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    food_key TEXT,
    old_calories INTEGER NOT NULL,
    new_calories INTEGER NOT NULL,
    reason TEXT,
    evidence_url TEXT,
    created_at TEXT NOT NULL
  );
`);
