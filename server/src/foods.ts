import { db } from "./db.js";

// Food knowledge base: turns scattered logs into accuracy. Each user keeps one
// value per food (their memory); when enough users' values agree, that food
// becomes crowd-"verified". Values are normalized to a basis — per 100g when
// grams are known, else per one item — so quantities and users are comparable.

export type Basis = "per_100g" | "per_item";
export type ObservationSource = "estimate" | "correction";
export type Provenance = "yours" | "verified" | "estimate" | "barcode";

export interface Nutrition {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface ResolvedNutrition {
  nutrition: Nutrition;
  source: Provenance;
  agreementCount: number | null; // set when source === "verified"
}

// A food is "verified" once at least this many distinct users' values cluster.
const VERIFY_MIN_USERS = 5;
// Values within ±15% of the median count as agreeing.
const AGREE_TOLERANCE = 0.15;

// The model emits a canonical English name; we only normalize casing/spacing so
// "Butter Crackers" and "butter crackers" collapse. Empty/whitespace -> null
// (that food just won't participate in the KB — it still logs fine).
export function normalizeFoodKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return key.length > 0 && key.length <= 80 ? key : null;
}

interface ObservationRow {
  basis: Basis;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: ObservationSource;
}

const getUserObsStmt = db.prepare(
  `SELECT basis, calories, protein_g, carbs_g, fat_g, source
     FROM food_observations WHERE food_key = ? AND user_id = ?`,
);

const getAllObsStmt = db.prepare(
  `SELECT basis, calories, protein_g, carbs_g, fat_g, source
     FROM food_observations WHERE food_key = ?`,
);

const upsertObsStmt = db.prepare(`
  INSERT INTO food_observations (food_key, user_id, basis, calories, protein_g, carbs_g, fat_g, source, updated_at)
  VALUES (:food_key, :user_id, :basis, :calories, :protein_g, :carbs_g, :fat_g, :source, :updated_at)
  ON CONFLICT(food_key, user_id) DO UPDATE SET
    basis = excluded.basis,
    calories = excluded.calories,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    source = excluded.source,
    updated_at = excluded.updated_at
`);

// Record (or update) this user's value for a food. An "estimate" never
// overwrites a value the user has already "corrected" — a correction is the
// stronger signal and should stick.
export function recordObservation(
  userId: string,
  foodKey: string,
  basis: Basis,
  nutrition: Nutrition,
  source: ObservationSource,
): void {
  if (source === "estimate") {
    const existing = getUserObsStmt.get(foodKey, userId) as unknown as ObservationRow | undefined;
    if (existing?.source === "correction") return; // don't downgrade a correction
  }
  upsertObsStmt.run({
    food_key: foodKey,
    user_id: userId,
    basis,
    calories: Math.round(nutrition.calories * 10) / 10,
    protein_g: nutrition.protein_g,
    carbs_g: nutrition.carbs_g,
    fat_g: nutrition.fat_g,
    source,
    updated_at: new Date().toISOString(),
  });
}

function scale(n: Nutrition, f: number): Nutrition {
  return {
    calories: n.calories * f,
    protein_g: n.protein_g == null ? null : n.protein_g * f,
    carbs_g: n.carbs_g == null ? null : n.carbs_g * f,
    fat_g: n.fat_g == null ? null : n.fat_g * f,
  };
}

// Total (as logged) -> per-basis. grams known -> per 100g; else per one item.
export function perBasisFromTotal(
  total: Nutrition,
  grams: number | null,
): { basis: Basis; nutrition: Nutrition } {
  if (grams && grams > 0) return { basis: "per_100g", nutrition: scale(total, 100 / grams) };
  return { basis: "per_item", nutrition: { ...total } };
}

// Per-basis -> the total to actually log for this quantity.
export function totalFromBasis(perBasis: Nutrition, basis: Basis, grams: number | null): Nutrition {
  if (basis === "per_100g" && grams && grams > 0) return scale(perBasis, grams / 100);
  return { ...perBasis };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? Math.round(median(present) * 10) / 10 : null;
}

export interface Consensus {
  basis: Basis;
  nutrition: Nutrition;
  agreementCount: number;
}

// Crowd consensus for a food, or null if not enough users agree yet. Uses the
// dominant basis, takes the median, and keeps the users within ±15% of it; if
// that cluster is at least VERIFY_MIN_USERS, the food is verified at the
// cluster's median.
export function getConsensus(foodKey: string): Consensus | null {
  const rows = getAllObsStmt.all(foodKey) as unknown as ObservationRow[];
  if (rows.length < VERIFY_MIN_USERS) return null;

  const per100 = rows.filter((r) => r.basis === "per_100g");
  const perItem = rows.filter((r) => r.basis === "per_item");
  const basis: Basis = per100.length >= perItem.length ? "per_100g" : "per_item";
  const group = basis === "per_100g" ? per100 : perItem;
  if (group.length < VERIFY_MIN_USERS) return null;

  const med = median(group.map((r) => r.calories));
  const clustered = group.filter((r) => Math.abs(r.calories - med) <= AGREE_TOLERANCE * med);
  if (clustered.length < VERIFY_MIN_USERS) return null;

  return {
    basis,
    nutrition: {
      calories: Math.round(median(clustered.map((r) => r.calories)) * 10) / 10,
      protein_g: medianOrNull(clustered.map((r) => r.protein_g)),
      carbs_g: medianOrNull(clustered.map((r) => r.carbs_g)),
      fat_g: medianOrNull(clustered.map((r) => r.fat_g)),
    },
    agreementCount: clustered.length,
  };
}

// Decide the nutrition to actually use for this log, best source first:
// the user's own remembered value, then crowd-verified, else the model's
// estimate. Only values on the SAME basis as the current log are eligible.
export function resolveNutrition(
  userId: string,
  foodKey: string,
  basis: Basis,
  modelNutrition: Nutrition,
): ResolvedNutrition {
  const mine = getUserObsStmt.get(foodKey, userId) as unknown as ObservationRow | undefined;
  if (mine && mine.basis === basis) {
    return {
      nutrition: {
        calories: mine.calories,
        protein_g: mine.protein_g,
        carbs_g: mine.carbs_g,
        fat_g: mine.fat_g,
      },
      source: "yours",
      agreementCount: null,
    };
  }

  const consensus = getConsensus(foodKey);
  if (consensus && consensus.basis === basis) {
    return { nutrition: consensus.nutrition, source: "verified", agreementCount: consensus.agreementCount };
  }

  return { nutrition: modelNutrition, source: "estimate", agreementCount: null };
}
