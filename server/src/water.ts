import { randomUUID } from "node:crypto";
import { db } from "./db.js";

// Water tracking (ticket #17). Deliberately its own table, not folded into
// food_entries — a glass of water has no calories/macros, and forcing it
// through the food model would mean every existing food_entries reader
// (Dashboard totals, exports, the corrections system) would need to learn
// to filter it back out. Simple v1: no configurable daily goal yet, the UI
// (WaterTracker.tsx) renders against a fixed 8-glass target.

const MAX_GLASSES_PER_LOG = 20; // a generous single-utterance/tap cap, not a daily cap
const MAX_DAILY_TOTAL = 40;

const insertStmt = db.prepare(`
  INSERT INTO water_entries (id, user_id, glasses, created_at) VALUES (:id, :user_id, :glasses, :created_at)
`);

// Same date(..., 'localtime') anchor pattern as food_entries (see
// entries.ts) — not a precomputed date column, so this can't drift out of
// sync with the app's own day-boundary fix (TZ=Europe/Bucharest).
const sumForDateStmt = db.prepare(`
  SELECT COALESCE(SUM(glasses), 0) AS total
    FROM water_entries
   WHERE user_id = :user_id AND date(created_at, 'localtime') = date(:anchor, 'localtime')
`);

const deleteForDateStmt = db.prepare(`
  DELETE FROM water_entries
   WHERE user_id = :user_id AND date(created_at, 'localtime') = date(:anchor, 'localtime')
`);

function anchorFor(date?: string): string {
  return date ? `${date}T12:00:00` : new Date().toISOString();
}

export function getWaterCount(userId: string, date?: string): number {
  const row = sumForDateStmt.get({ user_id: userId, anchor: anchorFor(date) }) as { total: number };
  return row.total;
}

// Voice path — always adds (never sets), matching how log_food only ever
// appends a new entry rather than overwriting the day's total.
export function addWater(userId: string, glasses: number): number {
  const clamped = Math.max(1, Math.min(MAX_GLASSES_PER_LOG, Math.round(glasses)));
  insertStmt.run({ id: randomUUID(), user_id: userId, glasses: clamped, created_at: new Date().toISOString() });
  return getWaterCount(userId);
}

// Tap path — the glasses-bar UI's "tap glass N to jump the day's level to N"
// gesture (like a star-rating widget) needs an absolute set, which isn't
// expressible as an append; replace the day's rows with one row for the
// new total rather than trying to reconcile a delta against however many
// rows are already there.
export function setWaterToday(userId: string, count: number): number {
  const clamped = Math.max(0, Math.min(MAX_DAILY_TOTAL, Math.round(count)));
  const anchor = anchorFor();
  deleteForDateStmt.run({ user_id: userId, anchor });
  if (clamped > 0) {
    insertStmt.run({ id: randomUUID(), user_id: userId, glasses: clamped, created_at: new Date().toISOString() });
  }
  return getWaterCount(userId);
}
