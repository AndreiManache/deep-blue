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
