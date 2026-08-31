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

const countUserFoodsStmt = db.prepare(
  `SELECT COUNT(DISTINCT food_key) AS n FROM food_observations WHERE user_id = ?`,
);
const distinctFoodKeysStmt = db.prepare(`SELECT DISTINCT food_key FROM food_observations`);

const listUserObsStmt = db.prepare(
  `SELECT food_key, basis, calories, protein_g, carbs_g, fat_g, source, updated_at
     FROM food_observations WHERE user_id = :user_id
    ORDER BY updated_at DESC`,
);

export interface UserObservation {
  food_key: string;
  basis: Basis;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  source: ObservationSource;
  updated_at: string;
}

// The "My Foods" screen (2026-08-27 backlog item) — every food this user has
// ever fed into the knowledge base, newest-touched first, so they can see
// and directly manage what the app remembers about their foods rather than
// only ever shaping it indirectly through logging/editing entries.
export function listUserObservations(userId: string): UserObservation[] {
  return listUserObsStmt.all({ user_id: userId }) as unknown as UserObservation[];
}

// Single-food lookup for the "log this again" quick action (My Foods
// screen) — same row recordObservation/resolveNutrition already read via
// getUserObsStmt, just exposed directly since the caller has one food_key
// in hand rather than iterating the whole list.
export function getUserObservation(
  userId: string,
  foodKey: string,
): { basis: Basis; nutrition: Nutrition } | undefined {
  const row = getUserObsStmt.get(foodKey, userId) as unknown as ObservationRow | undefined;
  if (!row) return undefined;
  return {
    basis: row.basis,
    nutrition: {
      calories: row.calories,
      protein_g: row.protein_g,
      carbs_g: row.carbs_g,
      fat_g: row.fat_g,
    },
  };
}

const deleteObsStmt = db.prepare(
  `DELETE FROM food_observations WHERE food_key = :food_key AND user_id = :user_id`,
);

export function deleteObservation(userId: string, foodKey: string): boolean {
  const result = deleteObsStmt.run({ food_key: foodKey, user_id: userId });
  return Number(result.changes) > 0;
}

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

// Same idea as totalFromBasis, but for the "log this again" quick action
// (My Foods screen) where a per_item food can be re-logged more than
// once at a time — totalFromBasis's per_item branch deliberately always
// assumes exactly 1 (that's what every existing caller needs), so this is
// additive rather than a behavior change to it.
export function scaleByQuantity(perBasis: Nutrition, basis: Basis, quantity: number): Nutrition {
  return basis === "per_100g" ? scale(perBasis, quantity / 100) : scale(perBasis, quantity);
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

// Growth snapshot for the Dashboard (2026-08-29 backlog item: "surface how
// big the database has gotten"). "yours" is a cheap COUNT; "verified" has no
// stored flag to count directly (see getConsensus above — it's computed
// on demand per food_key, not cached), so this re-runs that same clustering
// check across every distinct food_key. Fine at this scale (a few dozen
// foods for a friends-beta app); would need caching well before it wouldn't
// be. Note VERIFY_MIN_USERS=5 means "verified" is expected to read 0 until
// there are genuinely 5+ users logging overlapping foods.
export function getFoodDbStats(userId: string): { yours: number; verified: number } {
  const yours = (countUserFoodsStmt.get(userId) as { n: number }).n;
  const allKeys = distinctFoodKeysStmt.all() as { food_key: string }[];
  const verified = allKeys.filter((row) => getConsensus(row.food_key) !== null).length;
  return { yours, verified };
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
        // Calories is the one field "yours" exists to protect (a value
        // this user has already corrected or confirmed), so it's never
        // overridden. A macro that's null on the remembered value (e.g.
        // an earlier turn where the model didn't estimate carbs/fat) is
        // backfilled from this turn's fresh estimate instead of staying
        // null forever — otherwise one incomplete first log permanently
        // caps every future log of that food at the same missing data.
        calories: mine.calories,
        protein_g: mine.protein_g ?? modelNutrition.protein_g ?? null,
        carbs_g: mine.carbs_g ?? modelNutrition.carbs_g ?? null,
        fat_g: mine.fat_g ?? modelNutrition.fat_g ?? null,
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
