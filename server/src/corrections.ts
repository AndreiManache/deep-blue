import { randomUUID } from "node:crypto";
import { db } from "./db.js";

// Quick-select reasons offered in the edit UI — kept here as the single
// source of truth so the server can validate against the same list the
// client renders as chips.
export const CORRECTION_REASONS = [
  "wrong_portion",
  "wrong_food",
  "has_label",
  "skip",
] as const;
export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

export interface RecordCorrectionInput {
  entryId: string;
  userId: string;
  foodKey: string | null;
  oldCalories: number;
  newCalories: number;
  reason: CorrectionReason | null;
  evidenceUrl: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO entry_corrections (id, entry_id, user_id, food_key, old_calories, new_calories, reason, evidence_url, created_at)
  VALUES (:id, :entry_id, :user_id, :food_key, :old_calories, :new_calories, :reason, :evidence_url, :created_at)
`);

export function recordCorrection(input: RecordCorrectionInput): void {
  insertStmt.run({
    id: randomUUID(),
    entry_id: input.entryId,
    user_id: input.userId,
    food_key: input.foodKey,
    old_calories: Math.round(input.oldCalories),
    new_calories: Math.round(input.newCalories),
    reason: input.reason,
    evidence_url: input.evidenceUrl,
    created_at: new Date().toISOString(),
  });
}

export interface CorrectionRow {
  id: string;
  username: string;
  food_key: string | null;
  old_calories: number;
  new_calories: number;
  reason: string | null;
  evidence_url: string | null;
  created_at: string;
}

// Newest first, same convention as the feedback inbox.
const listStmt = db.prepare(`
  SELECT c.id, u.username, c.food_key, c.old_calories, c.new_calories, c.reason, c.evidence_url, c.created_at
    FROM entry_corrections c
    JOIN users u ON u.id = c.user_id
   ORDER BY c.created_at DESC
`);

export function listCorrections(): CorrectionRow[] {
  return listStmt.all() as unknown as CorrectionRow[];
}
