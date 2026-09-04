import { randomUUID } from "node:crypto";
import { db } from "./db.js";

// Workout logging (ticket #18). Deliberately just a record, per Andrei's
// explicit call — no calorie-burn estimate, no effect on the calorie
// target/TDEE math. If that's ever wanted, it's a distinct, separately-
// scoped feature, not something to sneak in here.

export interface WorkoutEntry {
  id: string;
  raw_transcript: string;
  description: string;
  duration_minutes: number | null;
  created_at: string;
}

const insertStmt = db.prepare(`
  INSERT INTO workout_entries (id, user_id, raw_transcript, description, duration_minutes, created_at)
  VALUES (:id, :user_id, :raw_transcript, :description, :duration_minutes, :created_at)
`);

// Same date(..., 'localtime') anchor pattern as food_entries/water_entries.
const selectByDateStmt = db.prepare(`
  SELECT id, raw_transcript, description, duration_minutes, created_at
    FROM workout_entries
   WHERE user_id = :user_id AND date(created_at, 'localtime') = date(:anchor, 'localtime')
   ORDER BY created_at ASC
`);

const deleteStmt = db.prepare(`DELETE FROM workout_entries WHERE id = :id AND user_id = :user_id`);

function anchorFor(date?: string): string {
  return date ? `${date}T12:00:00` : new Date().toISOString();
}

export function logWorkout(
  userId: string,
  input: { raw_transcript: string; description: string; duration_minutes?: number | null },
): WorkoutEntry {
  const entry: WorkoutEntry = {
    id: randomUUID(),
    raw_transcript: input.raw_transcript,
    description: input.description,
    duration_minutes: input.duration_minutes ?? null,
    created_at: new Date().toISOString(),
  };
  insertStmt.run({ user_id: userId, ...entry });
  return entry;
}

export function getWorkoutsForDate(userId: string, date?: string): WorkoutEntry[] {
  return selectByDateStmt.all({ user_id: userId, anchor: anchorFor(date) }) as unknown as WorkoutEntry[];
}

export function deleteWorkout(userId: string, id: string): boolean {
  const result = deleteStmt.run({ id, user_id: userId });
  return result.changes > 0;
}
