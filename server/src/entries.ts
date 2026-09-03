import { randomUUID } from "node:crypto";
import { type CorrectionReason, recordCorrection } from "./corrections.js";
import { db } from "./db.js";
import { perBasisFromTotal, recordObservation } from "./foods.js";

export interface FoodEntry {
  id: string;
  raw_transcript: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
  edited: boolean;
  // Food-knowledge fields (nullable on old rows / foods without a key).
  food_key: string | null;
  grams: number | null;
  source: string | null; // 'estimate' | 'yours' | 'verified' | 'barcode'
  agreement_count: number | null;
  // Whether this food_key is starred — see the "Favorite foods" section of
  // My Foods (2026-09-03). False (not null) when food_key is null, since
  // there's nothing to favorite.
  is_favorite: boolean;
}

interface FoodEntryRow {
  id: string;
  user_id: string;
  raw_transcript: string;
  description: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  created_at: string;
  edited: number;
  food_key: string | null;
  grams: number | null;
  source: string | null;
  agreement_count: number | null;
  is_favorite: number;
}

function rowToEntry(row: FoodEntryRow): FoodEntry {
  const { user_id: _userId, edited, is_favorite, ...rest } = row;
  return { ...rest, edited: Boolean(edited), is_favorite: Boolean(is_favorite) };
}

export interface CreateEntryInput {
  raw_transcript: string;
  description: string;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  food_key?: string | null;
  grams?: number | null;
  source?: string | null;
  agreement_count?: number | null;
}

const insertStmt = db.prepare(`
  INSERT INTO food_entries (id, user_id, raw_transcript, description, calories, protein_g, carbs_g, fat_g, created_at, edited, food_key, grams, source, agreement_count)
  VALUES (:id, :user_id, :raw_transcript, :description, :calories, :protein_g, :carbs_g, :fat_g, :created_at, :edited, :food_key, :grams, :source, :agreement_count)
`);

export function createEntry(userId: string, input: CreateEntryInput): FoodEntry {
  const row: FoodEntryRow = {
    id: randomUUID(),
    user_id: userId,
    raw_transcript: input.raw_transcript,
    description: input.description,
    calories: Math.round(input.calories),
    protein_g: input.protein_g ?? null,
    carbs_g: input.carbs_g ?? null,
    fat_g: input.fat_g ?? null,
    created_at: new Date().toISOString(),
    edited: 0,
    food_key: input.food_key ?? null,
    grams: input.grams ?? null,
    source: input.source ?? null,
    agreement_count: input.agreement_count ?? null,
    is_favorite: 0, // not a real column on food_entries — freshly logged, never favorited yet
  };
  const { is_favorite: _unused, ...insertRow } = row;
  insertStmt.run(insertRow as unknown as Record<string, string | number | null>);
  return rowToEntry(row);
}

// LEFT JOINed so an entry whose food_key has no observation row (or no
// food_key at all — a composition-described meat) still comes back, just
// with is_favorite false rather than dropping the entry.
const selectByDateStmt = db.prepare(`
  SELECT fe.*, COALESCE(fo.is_favorite, 0) AS is_favorite
    FROM food_entries fe
    LEFT JOIN food_observations fo ON fo.food_key = fe.food_key AND fo.user_id = fe.user_id
   WHERE fe.user_id = :user_id AND date(fe.created_at, 'localtime') = date(:anchor, 'localtime')
   ORDER BY fe.created_at ASC
`);

// date: 'YYYY-MM-DD' (interpreted as a local calendar day) — defaults to today.
export function getEntriesForDate(userId: string, date?: string): FoodEntry[] {
  const anchor = date ? `${date}T12:00:00` : new Date().toISOString();
  const rows = selectByDateStmt.all({ user_id: userId, anchor }) as unknown as FoodEntryRow[];
  return rows.map(rowToEntry);
}

const selectByIdStmt = db.prepare(`
  SELECT fe.*, COALESCE(fo.is_favorite, 0) AS is_favorite
    FROM food_entries fe
    LEFT JOIN food_observations fo ON fo.food_key = fe.food_key AND fo.user_id = fe.user_id
   WHERE fe.id = :id AND fe.user_id = :user_id
`);

export function getEntryById(userId: string, id: string): FoodEntry | undefined {
  const row = selectByIdStmt.get({ id, user_id: userId }) as unknown as FoodEntryRow | undefined;
  return row ? rowToEntry(row) : undefined;
}

export interface UpdateEntryInput {
  description?: string;
  calories?: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  // Optional context for *why* a calorie edit happened — see corrections.ts.
  // Ignored (silently) when calories isn't also being changed this call.
  correction_reason?: CorrectionReason | null;
  correction_evidence_url?: string | null;
}

const updateStmt = db.prepare(`
  UPDATE food_entries
  SET description = :description, calories = :calories, protein_g = :protein_g,
      carbs_g = :carbs_g, fat_g = :fat_g, edited = :edited, source = :source,
      agreement_count = :agreement_count
  WHERE id = :id AND user_id = :user_id
`);

export function updateEntry(userId: string, id: string, fields: UpdateEntryInput): FoodEntry | undefined {
  const existing = getEntryById(userId, id);
  if (!existing) return undefined;

  const caloriesChanged = fields.calories !== undefined;
  const merged: FoodEntryRow = {
    id: existing.id,
    user_id: userId,
    raw_transcript: existing.raw_transcript,
    description: fields.description ?? existing.description,
    calories: caloriesChanged ? Math.round(fields.calories as number) : existing.calories,
    protein_g: fields.protein_g !== undefined ? fields.protein_g : existing.protein_g,
    carbs_g: fields.carbs_g !== undefined ? fields.carbs_g : existing.carbs_g,
    fat_g: fields.fat_g !== undefined ? fields.fat_g : existing.fat_g,
    created_at: existing.created_at,
    edited: 1,
    food_key: existing.food_key,
    grams: existing.grams,
    // A calorie edit is the user's own confirmed value now — becomes "yours"
    // and feeds the knowledge base as a correction below.
    source: caloriesChanged ? "yours" : existing.source,
    agreement_count: caloriesChanged ? null : existing.agreement_count,
    is_favorite: existing.is_favorite ? 1 : 0,
  };

  updateStmt.run({
    id: merged.id,
    user_id: merged.user_id,
    description: merged.description,
    calories: merged.calories,
    protein_g: merged.protein_g,
    carbs_g: merged.carbs_g,
    fat_g: merged.fat_g,
    edited: merged.edited,
    source: merged.source,
    agreement_count: merged.agreement_count,
  });

  // Feed the correction back into the knowledge base — the strong signal that
  // trains the food's value for this user (and, once enough users agree, the
  // crowd consensus).
  if (caloriesChanged && merged.food_key) {
    const { basis, nutrition } = perBasisFromTotal(
      { calories: merged.calories, protein_g: merged.protein_g, carbs_g: merged.carbs_g, fat_g: merged.fat_g },
      merged.grams,
    );
    recordObservation(userId, merged.food_key, basis, nutrition, "correction");
  }

  // Audit trail: why the edit happened, separate from the value itself.
  if (caloriesChanged && merged.calories !== existing.calories) {
    recordCorrection({
      entryId: merged.id,
      userId,
      foodKey: merged.food_key,
      oldCalories: existing.calories,
      newCalories: merged.calories,
      reason: fields.correction_reason ?? null,
      evidenceUrl: fields.correction_evidence_url?.trim() || null,
    });
  }

  return rowToEntry(merged);
}

const deleteStmt = db.prepare(`DELETE FROM food_entries WHERE id = :id AND user_id = :user_id`);

export function deleteEntry(userId: string, id: string): boolean {
  const result = deleteStmt.run({ id, user_id: userId });
  return Number(result.changes) > 0;
}
