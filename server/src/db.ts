import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// On a host, only a mounted volume survives redeploys — point DEEPBLUE_DB_PATH
// at it there. Defaults to the local dev path otherwise.
const DB_PATH = process.env.DEEPBLUE_DB_PATH ?? path.join(__dirname, "..", "deepblue.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS food_entries (
    id TEXT PRIMARY KEY,
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
    id INTEGER PRIMARY KEY CHECK (id = 1),
    name TEXT,
    height_cm REAL,
    weight_kg REAL,
    age INTEGER,
    sex TEXT,
    activity_level TEXT,
    goal_type TEXT,
    goal_rate TEXT,
    goal_notes TEXT,
    updated_at TEXT NOT NULL
  );
`);
