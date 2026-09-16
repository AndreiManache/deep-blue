import { CURATED_FOODS, type CookingState } from "./curatedFoods.js";
import { db } from "./db.js";
import { perBasisFromTotal, totalFromBasis, type Basis, type Nutrition } from "./foods.js";

// The authoritative food database (food_density). This is the source of truth
// for a food's per-100g nutrition, shared across all users and keyed by
// (food_key, cooking_state). See db.ts for the table and the design rationale.
//
// Resolution contract (used by log_food): given a canonical food_key + the
// cooking state the model extracted, return the density to use — deterministic,
// no model arithmetic. A miss means "not in the DB yet"; the caller then falls
// back (USDA in a later slice, else the model estimate stored for review).

export type DensitySource = "admin" | "curated" | "usda" | "llm";
export type Confidence = "high" | "medium" | "low";

export interface DensityRow {
  food_key: string;
  cooking_state: CookingState;
  basis: Basis;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: DensitySource;
  source_id: string | null;
  confidence: Confidence;
  verified: number;
  needs_review: number;
  resolved_at: string;
}

// Leading cooking-method adjectives we can strip to fall back to a generic key
// ("grilled chicken breast" -> "chicken breast"), mapped to the state they
// imply. Kept small and explicit; the prompt does most of the canonicalizing.
const METHOD_WORD_STATE: Record<string, CookingState> = {
  raw: "raw",
  fresh: "raw",
  cooked: "cooked",
  boiled: "cooked",
  grilled: "cooked",
  fried: "cooked",
  "pan-fried": "cooked",
  "deep-fried": "cooked",
  baked: "cooked",
  roasted: "cooked",
  steamed: "cooked",
  poached: "cooked",
  sauteed: "cooked",
  seared: "cooked",
};

// Map the model's free-ish cooking_method to the coarse state the density
// table keys on. Unknown/none -> 'n/a' (the food doesn't distinguish state).
export function cookingStateFromMethod(method: unknown): CookingState {
  if (typeof method !== "string") return "n/a";
  const m = method.trim().toLowerCase();
  if (m === "raw" || m === "fresh") return "raw";
  if (m in METHOD_WORD_STATE) return METHOD_WORD_STATE[m]!;
  // Any other named preparation is some form of cooking.
  return m && m !== "none" && m !== "unknown" ? "cooked" : "n/a";
}

// ±band on calories by confidence, for the "295 kcal (265-330)" range output.
const RANGE_BAND: Record<Confidence, number> = { high: 0.08, medium: 0.15, low: 0.25 };

export function calorieRange(calories: number, confidence: Confidence): { low: number; high: number } {
  const band = RANGE_BAND[confidence];
  return { low: Math.round(calories * (1 - band)), high: Math.round(calories * (1 + band)) };
}

const getDensityStmt = db.prepare(
  `SELECT * FROM food_density WHERE food_key = :food_key AND cooking_state = :cooking_state`,
);

function readRow(foodKey: string, state: CookingState): DensityRow | undefined {
  return getDensityStmt.get({ food_key: foodKey, cooking_state: state }) as unknown as DensityRow | undefined;
}

function stripLeadingMethod(foodKey: string): string | null {
  const first = foodKey.split(" ")[0] ?? "";
  if (first in METHOD_WORD_STATE && foodKey.includes(" ")) {
    return foodKey.slice(first.length + 1).trim();
  }
  return null;
}

// Find the authoritative density for a food, trying the exact (key, state)
// first, then the state-agnostic 'n/a' row, then the same two against a
// generic key with a leading cooking-method word stripped. Returns undefined
// when the food isn't in the DB yet.
export function lookupDensity(foodKeyRaw: string, state: CookingState): DensityRow | undefined {
  const foodKey = foodKeyRaw.trim().toLowerCase();
  const candidates: [string, CookingState][] = [
    [foodKey, state],
    [foodKey, "n/a"],
  ];
  const stripped = stripLeadingMethod(foodKey);
  if (stripped) {
    candidates.push([stripped, state], [stripped, "n/a"]);
  }
  for (const [k, s] of candidates) {
    const row = readRow(k, s);
    if (row) return row;
  }
  return undefined;
}

const upsertStmt = db.prepare(`
  INSERT INTO food_density
    (food_key, cooking_state, basis, calories, protein_g, carbs_g, fat_g, source, source_id, confidence, verified, needs_review, resolved_at)
  VALUES
    (:food_key, :cooking_state, :basis, :calories, :protein_g, :carbs_g, :fat_g, :source, :source_id, :confidence, :verified, :needs_review, :resolved_at)
  ON CONFLICT(food_key, cooking_state) DO UPDATE SET
    basis = excluded.basis, calories = excluded.calories, protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, source = excluded.source,
    source_id = excluded.source_id, confidence = excluded.confidence, verified = excluded.verified,
    needs_review = excluded.needs_review, resolved_at = excluded.resolved_at
`);

export interface UpsertDensityInput {
  food_key: string;
  cooking_state: CookingState;
  basis?: Basis;
  nutrition: Nutrition;
  source: DensitySource;
  source_id?: string | null;
  confidence: Confidence;
  verified?: boolean;
  needs_review?: boolean;
}

// Full upsert — used by USDA write-through (later) and the admin panel. An
// explicit write always wins (replaces whatever was there).
export function upsertDensity(input: UpsertDensityInput): void {
  upsertStmt.run({
    food_key: input.food_key.trim().toLowerCase(),
    cooking_state: input.cooking_state,
    basis: input.basis ?? "per_100g",
    calories: Math.round(input.nutrition.calories * 10) / 10,
    protein_g: input.nutrition.protein_g,
    carbs_g: input.nutrition.carbs_g,
    fat_g: input.nutrition.fat_g,
    source: input.source,
    source_id: input.source_id ?? null,
    confidence: input.confidence,
    verified: input.verified ? 1 : 0,
    needs_review: input.needs_review ? 1 : 0,
    resolved_at: new Date().toISOString(),
  });
}

const insertIfAbsentStmt = db.prepare(`
  INSERT INTO food_density
    (food_key, cooking_state, basis, calories, protein_g, carbs_g, fat_g, source, source_id, confidence, verified, needs_review, resolved_at)
  VALUES
    (:food_key, :cooking_state, :basis, :calories, :protein_g, :carbs_g, :fat_g, 'llm', NULL, 'low', 0, 1, :resolved_at)
  ON CONFLICT(food_key, cooking_state) DO NOTHING
`);

// Last resort: the food isn't in the DB and no better source resolved it, so
// the model's own estimate becomes the DB's value going forward (the user's
// explicit design — "first time we log it we check it and store it; every
// time after that we just know"). Stored low-confidence + needs_review so an
// admin can vet it. ON CONFLICT DO NOTHING: never clobber a curated/usda/admin
// row, and don't let repeated logs churn the stored guess.
export function recordModelFallback(foodKey: string, state: CookingState, basis: Basis, perBasis: Nutrition): void {
  insertIfAbsentStmt.run({
    food_key: foodKey.trim().toLowerCase(),
    cooking_state: state,
    basis,
    calories: Math.round(perBasis.calories * 10) / 10,
    protein_g: perBasis.protein_g,
    carbs_g: perBasis.carbs_g,
    fat_g: perBasis.fat_g,
    resolved_at: new Date().toISOString(),
  });
}

export interface DbResolution {
  nutrition: Nutrition; // total for the logged amount
  confidence: Confidence;
  verified: boolean;
  dbSource: DensitySource;
}

// Resolve a food from the authoritative DB into the TOTAL nutrition to log for
// this quantity, or undefined if it isn't in the DB. `grams` scales a per_100g
// row; a per_item row logs as one item.
export function resolveDensity(foodKeyRaw: string, state: CookingState, grams: number | null): DbResolution | undefined {
  const row = lookupDensity(foodKeyRaw, state);
  if (!row) return undefined;
  const perBasis: Nutrition = {
    calories: row.calories,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    fat_g: row.fat_g,
  };
  return {
    nutrition: totalFromBasis(perBasis, row.basis, grams),
    confidence: row.confidence,
    verified: row.verified === 1,
    dbSource: row.source,
  };
}

// Convert a model's total estimate to the per-basis shape food_density stores.
export function toPerBasis(total: Nutrition, grams: number | null): { basis: Basis; perBasis: Nutrition } {
  const { basis, nutrition } = perBasisFromTotal(total, grams);
  return { basis, perBasis: nutrition };
}

// Idempotent seed of the curated foods. Re-asserts curated rows on every boot
// (so improving a seed value ships) but never overwrites an admin/usda/llm row
// — only rows already marked source='curated' are refreshed.
const seedStmt = db.prepare(`
  INSERT INTO food_density
    (food_key, cooking_state, basis, calories, protein_g, carbs_g, fat_g, source, source_id, confidence, verified, needs_review, resolved_at)
  VALUES
    (:food_key, :cooking_state, 'per_100g', :calories, :protein_g, :carbs_g, :fat_g, 'curated', NULL, 'high', 1, 0, :resolved_at)
  ON CONFLICT(food_key, cooking_state) DO UPDATE SET
    calories = excluded.calories, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g, confidence = 'high', verified = 1, needs_review = 0,
    resolved_at = excluded.resolved_at
  WHERE food_density.source = 'curated'
`);

// --- Admin panel: browse / curate the food database -----------------------

const listStmt = db.prepare(`
  SELECT * FROM food_density
  ORDER BY needs_review DESC, verified ASC, resolved_at DESC
`);

// Every row, review-queue first (needs_review), then unverified, newest first.
export function listDensities(): DensityRow[] {
  return listStmt.all() as unknown as DensityRow[];
}

const verifyStmt = db.prepare(`
  UPDATE food_density SET verified = 1, needs_review = 0, resolved_at = :resolved_at
  WHERE food_key = :food_key AND cooking_state = :cooking_state
`);

// Approve an AI-resolved (usda/llm) row as-is — trusts its current values and
// clears it from the review queue, without changing the numbers.
export function verifyDensity(foodKey: string, state: string): boolean {
  const r = verifyStmt.run({
    food_key: foodKey.trim().toLowerCase(),
    cooking_state: state,
    resolved_at: new Date().toISOString(),
  });
  return Number(r.changes) > 0;
}

const deleteStmt = db.prepare(
  `DELETE FROM food_density WHERE food_key = :food_key AND cooking_state = :cooking_state`,
);

export function deleteDensity(foodKey: string, state: string): boolean {
  const r = deleteStmt.run({ food_key: foodKey.trim().toLowerCase(), cooking_state: state });
  return Number(r.changes) > 0;
}

export function reviewQueueCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM food_density WHERE needs_review = 1`).get() as { n: number }).n;
}

export function seedCuratedFoods(): number {
  const now = new Date().toISOString();
  let n = 0;
  for (const f of CURATED_FOODS) {
    seedStmt.run({
      food_key: f.food_key,
      cooking_state: f.cooking_state,
      calories: f.calories,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
      resolved_at: now,
    });
    n++;
  }
  return n;
}
