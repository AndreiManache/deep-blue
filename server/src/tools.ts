import type Anthropic from "@anthropic-ai/sdk";
import { createEntry, deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import {
  normalizeFoodKey,
  perBasisFromTotal,
  recordObservation,
  resolveNutrition,
  totalFromBasis,
  type Nutrition,
} from "./foods.js";
import { computeCompositionNutrition, type Preparation } from "./nutrition.js";
import { upsertProfile, type ProfileUpdateInput } from "./profile.js";
import { validateProfileInput } from "./validation.js";
import { addWater } from "./water.js";
import { logWorkout } from "./workouts.js";

// Plain JSON Schema — the shape both Anthropic's `input_schema` and Gemini's
// `parameters` already use natively, so one definition covers both providers.
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema | { type: string; enum?: string[]; description?: string }>;
  required?: string[];
  enum?: string[];
  description?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

// Single source of truth for every tool the model can call. Defined once,
// provider-agnostic, and adapted below — so Anthropic's and Gemini's tool
// lists can never silently drift out of sync with each other.
export const toolDefs: ToolDef[] = [
  {
    name: "log_food",
    description:
      "Create a new food log entry. Two ways to provide nutrition — pick exactly one: " +
      "(1) For normal foods, pass your own `calories` estimate (plus optional macros). Use reasonable estimates for common foods — do not ask the user for exact numbers. " +
      "(2) When the user gives a fat/lean composition ratio for a meat-based food along with a total weight (e.g. '250 grams, 60% fat 40% meat'), pass `total_weight_g`, `fat_ratio_pct` and `preparation` INSTEAD of estimating — the server computes calories and macros deterministically from tissue composition, which is more accurate than estimating such cuts as one generic value.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Clean, short description of the food, e.g. 'two fried eggs'. Write it in the same language you're conversing in.",
        },
        food_key: {
          type: "string",
          description:
            "ALWAYS provide this. A canonical, generic name for the food in ENGLISH, lowercase, singular, no quantity and no brand unless essential to identity — e.g. 'butter crackers', 'grilled chicken breast', 'french fries', 'coca-cola'. Used to match the same food across users and languages (Romanian 'biscuiți cu unt' -> 'butter crackers'), so keep it stable and generic.",
        },
        grams: {
          type: "number",
          description:
            "Total weight of the logged amount in grams. Estimate it whenever you reasonably can (e.g. '5 sarmale' ≈ 500) — it lets nutrition be stored per-100g and reused accurately. Omit only for discrete branded items where weight is meaningless (e.g. 'a can of coke').",
        },
        calories: { type: "number", description: "Estimated total calories (way 1)" },
        protein_g: { type: "number", description: "Estimated grams of protein (way 1)" },
        carbs_g: { type: "number", description: "Estimated grams of carbohydrates (way 1)" },
        fat_g: { type: "number", description: "Estimated grams of fat (way 1)" },
        total_weight_g: {
          type: "number",
          description: "Total weight in grams of a composition-described meat (way 2)",
        },
        fat_ratio_pct: {
          type: "number",
          description:
            "Visual fat share of the cut, 0-100 — '60% fat 40% meat' is 60 (way 2)",
        },
        preparation: {
          type: "string",
          enum: ["raw", "cooked", "cured"],
          description:
            "How the meat was prepared — cooked covers grilled/fried/roasted; cured covers dried/smoked/pastrami-style (way 2, defaults to cooked)",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "get_entries",
    description:
      "Read logged food entries for a day. Defaults to today. Use this when the user asks about their day, OR when you need an entry's id to edit/delete it.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, defaults to today if omitted" },
      },
    },
  },
  {
    name: "update_entry",
    description: "Modify an existing food entry by id (e.g. correcting the quantity or description).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        calories: { type: "number" },
        protein_g: { type: "number" },
        carbs_g: { type: "number" },
        fat_g: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_entry",
    description: "Remove a food entry by id.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_profile",
    description:
      "Create or update the user's profile: name, height, weight, age, biological sex, activity level, fitness goal, and conversation language. Call this whenever the user states or changes any of this info by voice. All fields optional — only pass what changed.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        height_cm: { type: "number" },
        weight_kg: { type: "number" },
        age: { type: "number" },
        sex: { type: "string", enum: ["male", "female"], description: "Needed for the calorie formula" },
        activity_level: {
          type: "string",
          enum: ["sedentary", "light", "moderate", "active", "very_active"],
        },
        goal_type: { type: "string", enum: ["lose", "maintain", "gain"] },
        goal_rate: {
          type: "string",
          enum: ["gentle", "moderate", "aggressive"],
          description: "How fast they want to lose/gain",
        },
        goal_notes: {
          type: "string",
          description: "Free-text nuance, e.g. 'avoid losing muscle while cutting'",
        },
        language: {
          type: "string",
          enum: ["en", "ro"],
          description:
            "The user's preferred spoken language. Call this if they ask to switch to Romanian/English, or address you in Romanian for the first time. Takes effect starting with this reply.",
        },
      },
    },
  },
  {
    name: "log_water",
    description:
      "Log water the user just drank. Call whenever they mention drinking water (or a comparable plain-water amount) — never asks them to repeat it later, just log it in the same turn. Purely a count of glasses, no calories/macros involved.",
    parameters: {
      type: "object",
      properties: {
        glasses: {
          type: "number",
          description:
            "How many glasses (roughly 250ml each). Defaults to 1 if they didn't say a number ('I had some water' -> 1). Convert an explicit volume yourself (e.g. '500ml' -> 2, 'a liter' -> 4).",
        },
      },
    },
  },
  {
    name: "log_workout",
    description:
      "Record a workout/exercise the user mentions (e.g. 'I went for a run', 'did an hour of gym'). This is purely a record for their own log — it does NOT estimate calories burned and does NOT change their daily calorie target, so never mention calories burned when confirming one of these.",
    parameters: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Short description of the activity, e.g. '30 minute run', 'gym session — legs'. Same language as the conversation.",
        },
        duration_minutes: {
          type: "number",
          description: "How long, in minutes, if mentioned or reasonably inferable. Omit if genuinely unknown.",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "end_conversation",
    description:
      "Call this when the user is clearly done talking (says goodbye, 'that's all', 'I'm done', etc). Say a brief goodbye in your reply text at the same time.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
];

export const anthropicTools: Anthropic.Tool[] = toolDefs.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters as Anthropic.Tool["input_schema"],
}));

// Gemini's Interactions API function-tool shape: a flat object per function
// (not wrapped in a `functionDeclarations` array like the older Gemini SDKs).
export interface GeminiFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
}

export const geminiTools: GeminiFunctionTool[] = toolDefs.map((t) => ({
  type: "function",
  name: t.name,
  description: t.description,
  parameters: t.parameters,
}));

export interface ToolExecutionResult {
  content: string;
  isError: boolean;
  mutated: boolean;
  ended: boolean;
}

export function executeTool(
  userId: string,
  name: string,
  input: Record<string, unknown>,
  userTranscript?: string,
): ToolExecutionResult {
  try {
    switch (name) {
      case "log_food": {
        const hasComposition =
          typeof input.total_weight_g === "number" && typeof input.fat_ratio_pct === "number";

        let nutrition: { calories: number; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null };
        if (hasComposition) {
          const totalWeight = input.total_weight_g as number;
          const fatRatio = input.fat_ratio_pct as number;
          if (!Number.isFinite(totalWeight) || totalWeight <= 0 || totalWeight > 5000) {
            return { content: "total_weight_g must be between 1 and 5000", isError: true, mutated: false, ended: false };
          }
          if (!Number.isFinite(fatRatio) || fatRatio < 0 || fatRatio > 100) {
            return { content: "fat_ratio_pct must be between 0 and 100", isError: true, mutated: false, ended: false };
          }
          nutrition = computeCompositionNutrition({
            total_weight_g: totalWeight,
            fat_ratio_pct: fatRatio,
            preparation: input.preparation as Preparation | undefined,
          });
        } else if (typeof input.calories === "number" && Number.isFinite(input.calories) && input.calories >= 0) {
          nutrition = {
            calories: input.calories,
            protein_g: input.protein_g as number | undefined,
            carbs_g: input.carbs_g as number | undefined,
            fat_g: input.fat_g as number | undefined,
          };
        } else {
          return {
            content:
              "log_food needs either calories (way 1), or total_weight_g + fat_ratio_pct for a composition-described meat (way 2)",
            isError: true,
            mutated: false,
            ended: false,
          };
        }

        // --- Food knowledge base: prefer a known-good value over the estimate ---
        const totalNutrition: Nutrition = {
          calories: nutrition.calories,
          protein_g: nutrition.protein_g ?? null,
          carbs_g: nutrition.carbs_g ?? null,
          fat_g: nutrition.fat_g ?? null,
        };
        const foodKey = normalizeFoodKey(input.food_key);
        const grams = hasComposition
          ? (input.total_weight_g as number)
          : typeof input.grams === "number" && input.grams > 0
            ? (input.grams as number)
            : null;

        let used = totalNutrition;
        let source: string | null = null;
        let agreementCount: number | null = null;

        if (foodKey) {
          const { basis, nutrition: perBasisModel } = perBasisFromTotal(totalNutrition, grams);
          if (hasComposition) {
            // The deterministic tissue calc is authoritative for a described
            // cut — don't override it, but still contribute the observation.
            source = "estimate";
          } else {
            const resolved = resolveNutrition(userId, foodKey, basis, perBasisModel);
            used = totalFromBasis(resolved.nutrition, resolved.basis, grams);
            source = resolved.source;
            agreementCount = resolved.agreementCount;
          }
          // Seed this user's own value the first time they log this food
          // (no-op if they already have one; edits record corrections instead).
          recordObservation(userId, foodKey, basis, perBasisModel, "estimate");
        }

        const entry = createEntry(userId, {
          // Spec: raw_transcript is what the user actually said — the real
          // turn text, not the model's cleaned description.
          raw_transcript: userTranscript ?? (input.description as string),
          description: input.description as string,
          calories: used.calories,
          protein_g: used.protein_g,
          carbs_g: used.carbs_g,
          fat_g: used.fat_g,
          food_key: foodKey,
          grams,
          source,
          agreement_count: agreementCount,
        });
        return { content: JSON.stringify(entry), isError: false, mutated: true, ended: false };
      }
      case "get_entries": {
        const entries = getEntriesForDate(userId, input.date as string | undefined);
        const total = entries.reduce((sum, e) => sum + e.calories, 0);
        return {
          content: JSON.stringify({ entries, total_calories: total }),
          isError: false,
          mutated: false,
          ended: false,
        };
      }
      case "update_entry": {
        const { id, ...fields } = input as { id: string } & Record<string, unknown>;
        const updated = updateEntry(userId, id, fields);
        if (!updated) {
          return { content: `No entry found with id ${id}`, isError: true, mutated: false, ended: false };
        }
        return { content: JSON.stringify(updated), isError: false, mutated: true, ended: false };
      }
      case "delete_entry": {
        const ok = deleteEntry(userId, input.id as string);
        if (!ok) {
          return { content: `No entry found with id ${input.id}`, isError: true, mutated: false, ended: false };
        }
        return { content: "deleted", isError: false, mutated: true, ended: false };
      }
      case "update_profile": {
        // Same guard the HTTP route gets — a misheard "weight 700 kilos"
        // must bounce back to the model for correction, not poison the BMR.
        const validationError = validateProfileInput(input);
        if (validationError) {
          return { content: validationError, isError: true, mutated: false, ended: false };
        }
        const updated = upsertProfile(userId, input as ProfileUpdateInput);
        return { content: JSON.stringify(updated), isError: false, mutated: false, ended: false };
      }
      case "log_water": {
        const glasses = typeof input.glasses === "number" && Number.isFinite(input.glasses) ? input.glasses : 1;
        const total = addWater(userId, glasses);
        return { content: JSON.stringify({ glasses_added: glasses, total_today: total }), isError: false, mutated: true, ended: false };
      }
      case "log_workout": {
        const durationRaw = input.duration_minutes;
        const duration_minutes = typeof durationRaw === "number" && Number.isFinite(durationRaw) ? durationRaw : null;
        const entry = logWorkout(userId, {
          raw_transcript: userTranscript ?? (input.description as string),
          description: input.description as string,
          duration_minutes,
        });
        return { content: JSON.stringify(entry), isError: false, mutated: true, ended: false };
      }
      case "end_conversation": {
        return { content: "session ending", isError: false, mutated: false, ended: true };
      }
      default:
        return { content: `Unknown tool: ${name}`, isError: true, mutated: false, ended: false };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Tool error: ${message}`, isError: true, mutated: false, ended: false };
  }
}
