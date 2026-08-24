import { randomUUID } from "node:crypto";
import { db } from "./db.js";

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
}

function rowToEntry(row: FoodEntryRow): FoodEntry {
  const { user_id: _userId, edited, ...rest } = row;
  return { ...rest, edited: Boolean(edited) };
}

export interface CreateEntryInput {
  raw_transcript: string;
  description: string;
  calories: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

const insertStmt = db.prepare(`
  INSERT INTO food_entries (id, user_id, raw_transcript, description, calories, protein_g, carbs_g, fat_g, created_at, edited)
  VALUES (:id, :user_id, :raw_transcript, :description, :calories, :protein_g, :carbs_g, :fat_g, :created_at, :edited)
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
  };
  insertStmt.run(row as unknown as Record<string, string | number | null>);
  return rowToEntry(row);
}

const selectByDateStmt = db.prepare(`
  SELECT * FROM food_entries
  WHERE user_id = :user_id AND date(created_at, 'localtime') = date(:anchor, 'localtime')
  ORDER BY created_at ASC
`);

// date: 'YYYY-MM-DD' (interpreted as a local calendar day) — defaults to today.
export function getEntriesForDate(userId: string, date?: string): FoodEntry[] {
  const anchor = date ? `${date}T12:00:00` : new Date().toISOString();
  const rows = selectByDateStmt.all({ user_id: userId, anchor }) as unknown as FoodEntryRow[];
  return rows.map(rowToEntry);
}

const selectByIdStmt = db.prepare(`SELECT * FROM food_entries WHERE id = :id AND user_id = :user_id`);

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
}

const updateStmt = db.prepare(`
  UPDATE food_entries
  SET description = :description, calories = :calories, protein_g = :protein_g,
      carbs_g = :carbs_g, fat_g = :fat_g, edited = :edited
  WHERE id = :id AND user_id = :user_id
`);

export function updateEntry(userId: string, id: string, fields: UpdateEntryInput): FoodEntry | undefined {
  const existing = getEntryById(userId, id);
  if (!existing) return undefined;

  const merged: FoodEntryRow = {
    id: existing.id,
    user_id: userId,
    raw_transcript: existing.raw_transcript,
    description: fields.description ?? existing.description,
    calories: fields.calories !== undefined ? Math.round(fields.calories) : existing.calories,
    protein_g: fields.protein_g !== undefined ? fields.protein_g : existing.protein_g,
    carbs_g: fields.carbs_g !== undefined ? fields.carbs_g : existing.carbs_g,
    fat_g: fields.fat_g !== undefined ? fields.fat_g : existing.fat_g,
    created_at: existing.created_at,
    edited: 1,
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
  });

  return rowToEntry(merged);
}

const deleteStmt = db.prepare(`DELETE FROM food_entries WHERE id = :id AND user_id = :user_id`);

export function deleteEntry(userId: string, id: string): boolean {
  const result = deleteStmt.run({ id, user_id: userId });
  return Number(result.changes) > 0;
}
