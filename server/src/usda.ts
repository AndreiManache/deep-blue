import { USDA_API_KEY } from "./config.js";
import type { CookingState } from "./curatedFoods.js";
import type { Confidence } from "./foodDb.js";
import type { Nutrition } from "./foods.js";

// USDA FoodData Central client. Resolves a food to per-100g nutrition from an
// authoritative public database, for foods not yet in our own DB. Deliberately
// forgiving AND conservative: any failure (timeout, rate limit, no match)
// returns null so a live voice turn is never blocked; and a fuzzy/ambiguous
// match is rejected rather than trusted, because USDA's top hit for a generic
// query is often the wrong form (searching "banana" surfaces DRIED banana at
// 346 kcal/100g, not raw at 89). A returned match is stored for admin review.

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const DETAIL_URL = "https://api.nal.usda.gov/fdc/v1/food";
// Whole-food, per-100g data types. Branded is intentionally excluded — brand
// label data is the wrong answer for a generic query.
const DATA_TYPES = "Foundation,SR Legacy,Survey (FNDDS)";
const TIMEOUT_MS = 2500;

const N_ENERGY_KCAL = 1008;
const N_PROTEIN = 1003;
const N_CARBS = 1005;
const N_FAT = 1004;

// Processed/altered forms that must not silently answer a generic whole-food
// query. A form is only disqualifying when the query itself didn't ask for it.
const PROCESSED = ["dried", "dehydrated", "powder", "flour", "chips", "crisps", "juice", "concentrate", "infant", "baby", "canned", "smoked", "breaded", "roll", "luncheon", "deli", "spread"];
const COOKED_WORDS = /\b(cooked|roasted|boiled|grilled|baked|braised|steamed)\b/;

interface FdcNutrient {
  nutrientId?: number;
  nutrientName?: string;
  unitName?: string;
  value?: number;
}
interface FdcFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: FdcNutrient[];
}

export interface UsdaResult {
  perBasis: Nutrition; // per 100g
  fdcId: string;
  dataType: string;
  description: string;
  confidence: Confidence;
}

function nutrientValue(nutrients: FdcNutrient[], id: number): number | null {
  const hit = nutrients.find((n) => n.nutrientId === id);
  return hit && typeof hit.value === "number" && Number.isFinite(hit.value) ? hit.value : null;
}

function energyKcal(nutrients: FdcNutrient[]): number | null {
  const direct = nutrientValue(nutrients, N_ENERGY_KCAL);
  if (direct != null) return direct;
  const named = nutrients.find(
    (n) => /energy/i.test(n.nutrientName ?? "") && (n.unitName ?? "").toUpperCase() === "KCAL",
  );
  return named && typeof named.value === "number" && Number.isFinite(named.value) ? named.value : null;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Rank a candidate for how well it answers the query, or null to reject it.
// Requires every query word present; rejects processed forms the query didn't
// ask for; prefers cleaner data types, matching cooking state, and shorter
// (i.e. less oddly-specific) descriptions.
function scoreCandidate(food: FdcFood, queryWords: string[], state: CookingState): number | null {
  const desc = food.description.toLowerCase();
  if (!queryWords.every((w) => desc.includes(w))) return null;
  for (const bad of PROCESSED) {
    if (desc.includes(bad) && !queryWords.includes(bad)) return null;
  }
  // A raw query must not be answered by a clearly-cooked entry, and vice versa.
  const looksCooked = COOKED_WORDS.test(desc);
  if (state === "raw" && looksCooked) return null;

  let score = 0;
  score += food.dataType === "Foundation" ? 3 : food.dataType === "SR Legacy" ? 2 : 1;
  if (state === "cooked" && looksCooked) score += 2;
  if (state === "raw" && /\braw\b/.test(desc)) score += 2;
  score -= Math.min(desc.length / 40, 3);
  return score;
}

export async function lookupUsda(foodKey: string, state: CookingState): Promise<UsdaResult | null> {
  if (!USDA_API_KEY) return null; // explicitly disabled (e.g. in tests)
  const queryWords = foodKey.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return null;

  const url =
    `${SEARCH_URL}?api_key=${encodeURIComponent(USDA_API_KEY)}` +
    `&query=${encodeURIComponent(foodKey)}` +
    `&dataType=${encodeURIComponent(DATA_TYPES)}` +
    `&pageSize=10&requireAllWords=true`;

  const data = await getJson<{ foods?: FdcFood[] }>(url);
  const foods = data?.foods ?? [];

  // Pick the best qualifying candidate; reject the query entirely if none
  // qualify (better a model estimate than a confidently-wrong USDA match).
  let best: { food: FdcFood; score: number } | null = null;
  for (const food of foods) {
    const score = scoreCandidate(food, queryWords, state);
    if (score != null && (!best || score > best.score)) best = { food, score };
  }
  if (!best) return null;

  const food = best.food;
  // Search results sometimes omit the energy nutrient; fetch the full record
  // for the chosen match when needed.
  let nutrients = food.foodNutrients ?? [];
  let kcal = energyKcal(nutrients);
  if (kcal == null) {
    const detail = await getJson<FdcFood>(`${DETAIL_URL}/${food.fdcId}?api_key=${encodeURIComponent(USDA_API_KEY)}`);
    if (detail?.foodNutrients) {
      nutrients = detail.foodNutrients;
      kcal = energyKcal(nutrients);
    }
  }
  if (kcal == null) return null;

  // Foundation/SR Legacy are the cleanest sources but the match is still an
  // automated best-guess, so cap confidence at 'medium'; FNDDS goes 'low'.
  const confidence: Confidence = food.dataType === "Foundation" || food.dataType === "SR Legacy" ? "medium" : "low";

  return {
    perBasis: {
      calories: kcal,
      protein_g: nutrientValue(nutrients, N_PROTEIN),
      carbs_g: nutrientValue(nutrients, N_CARBS),
      fat_g: nutrientValue(nutrients, N_FAT),
    },
    fdcId: String(food.fdcId),
    dataType: food.dataType ?? "unknown",
    description: food.description,
    confidence,
  };
}
