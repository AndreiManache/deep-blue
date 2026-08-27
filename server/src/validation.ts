// Minimal hand-rolled validation — enough to keep NaN, absurd numbers and
// out-of-enum strings out of SQLite and the BMR formula, without pulling in
// a schema library. Each validator returns an error message, or null when
// the input is acceptable. Fields that are absent/null always pass: partial
// updates are the norm here.

const SEXES = ["male", "female"];
const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"];
const GOAL_TYPES = ["lose", "maintain", "gain"];
const GOAL_RATES = ["gentle", "moderate", "aggressive"];
const LANGUAGES = ["en", "ro"];

function badNumber(value: unknown, min: number, max: number): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "number" || !Number.isFinite(value) || value < min || value > max;
}

function badString(value: unknown, maxLen: number): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.length > maxLen;
}

function badEnum(value: unknown, allowed: string[]): boolean {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || !allowed.includes(value);
}

export function validateProfileInput(body: Record<string, unknown>): string | null {
  if (typeof body !== "object" || body === null) return "Body must be an object";
  if (badString(body.name, 120)) return "name must be a string of at most 120 characters";
  if (badNumber(body.height_cm, 50, 260)) return "height_cm must be a number between 50 and 260";
  if (badNumber(body.weight_kg, 20, 400)) return "weight_kg must be a number between 20 and 400";
  if (badNumber(body.age, 5, 120)) return "age must be a number between 5 and 120";
  if (badEnum(body.sex, SEXES)) return `sex must be one of: ${SEXES.join(", ")}`;
  if (badEnum(body.activity_level, ACTIVITY_LEVELS))
    return `activity_level must be one of: ${ACTIVITY_LEVELS.join(", ")}`;
  if (badEnum(body.goal_type, GOAL_TYPES)) return `goal_type must be one of: ${GOAL_TYPES.join(", ")}`;
  if (badEnum(body.goal_rate, GOAL_RATES)) return `goal_rate must be one of: ${GOAL_RATES.join(", ")}`;
  if (badString(body.goal_notes, 500)) return "goal_notes must be a string of at most 500 characters";
  if (badEnum(body.language, LANGUAGES)) return `language must be one of: ${LANGUAGES.join(", ")}`;
  return null;
}

export function validateBarcodeEntry(body: Record<string, unknown>): string | null {
  if (typeof body !== "object" || body === null) return "Body must be an object";
  if (typeof body.barcode !== "string" || !/^\d{8,14}$/.test(body.barcode))
    return "barcode must be a string of 8 to 14 digits";
  if (typeof body.grams !== "number" || !Number.isFinite(body.grams) || body.grams <= 0 || body.grams > 5000)
    return "grams must be a number between 0 and 5000";
  return null;
}

export function validateEntryPatch(body: Record<string, unknown>): string | null {
  if (typeof body !== "object" || body === null) return "Body must be an object";
  if (body.description !== undefined) {
    if (typeof body.description !== "string" || !body.description.trim() || body.description.length > 300)
      return "description must be a non-empty string of at most 300 characters";
  }
  if (badNumber(body.calories, 0, 20000)) return "calories must be a number between 0 and 20000";
  if (badNumber(body.protein_g, 0, 5000)) return "protein_g must be a number between 0 and 5000";
  if (badNumber(body.carbs_g, 0, 5000)) return "carbs_g must be a number between 0 and 5000";
  if (badNumber(body.fat_g, 0, 5000)) return "fat_g must be a number between 0 and 5000";
  return null;
}
