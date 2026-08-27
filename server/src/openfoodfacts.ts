import type { Nutrition } from "./foods.js";

// Open Food Facts is free and keyless, but its usage policy asks for a
// descriptive User-Agent identifying the app — generic/browser UAs get
// throttled more aggressively.
const USER_AGENT = "DeepBlue/1.0 (food-logging app; contact: manacheandrei@gmail.com)";
const LOOKUP_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_SIZE = 500;

export interface OffProduct {
  name: string;
  brand: string | null;
  // Always per_100g — that's the unit Open Food Facts reports nutriments in.
  nutrition: Nutrition;
}

interface CacheEntry {
  value: OffProduct | null;
  expiresAt: number;
}

// Barcode -> product (or a cached miss). Small and TTL'd so a GET preview
// immediately followed by the POST that logs the entry doesn't double-hit the
// network for the same code.
const cache = new Map<string, CacheEntry>();

function cacheGet(barcode: string): OffProduct | null | undefined {
  const entry = cache.get(barcode);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(barcode);
    return undefined;
  }
  return entry.value;
}

function cacheSet(barcode: string, value: OffProduct | null): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(barcode, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface OffApiResponse {
  status?: number;
  product?: {
    product_name?: string;
    brands?: string;
    nutriments?: Record<string, unknown>;
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Looks up a barcode against Open Food Facts. Returns null both when the
// product is unknown and when it has no calorie figure to log against — a
// record with no energy value is as useless to us as no record at all, and
// callers treat both the same way (hand off to the voice flow).
export async function lookupBarcode(barcode: string): Promise<OffProduct | null> {
  const cached = cacheGet(barcode);
  if (cached !== undefined) return cached;

  let result: OffProduct | null = null;
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=product_name,brands,nutriments`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (res.ok) {
      const data = (await res.json()) as OffApiResponse;
      const calories = numberOrNull(data.product?.nutriments?.["energy-kcal_100g"]);
      if (data.status === 1 && data.product && calories != null) {
        result = {
          name: data.product.product_name?.trim() || "Unknown product",
          brand: data.product.brands?.split(",")[0]?.trim() || null,
          nutrition: {
            calories,
            protein_g: numberOrNull(data.product.nutriments?.["proteins_100g"]),
            carbs_g: numberOrNull(data.product.nutriments?.["carbohydrates_100g"]),
            fat_g: numberOrNull(data.product.nutriments?.["fat_100g"]),
          },
        };
      }
    }
  } catch {
    result = null; // network/parse failure -> treat as a miss, never throw
  }

  cacheSet(barcode, result);
  return result;
}
