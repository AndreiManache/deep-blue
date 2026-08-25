import type Anthropic from "@anthropic-ai/sdk";
import { createEntry, deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import { computeCompositionNutrition, type Preparation } from "./nutrition.js";
import { upsertProfile, type ProfileUpdateInput } from "./profile.js";
import { validateProfileInput } from "./validation.js";

export const tools: Anthropic.Tool[] = [
  {
    name: "log_food",
    description:
      "Create a new food log entry. Two ways to provide nutrition — pick exactly one: " +
      "(1) For normal foods, pass your own `calories` estimate (plus optional macros). Use reasonable estimates for common foods — do not ask the user for exact numbers. " +
      "(2) When the user gives a fat/lean composition ratio for a meat-based food along with a total weight (e.g. '250 grams, 60% fat 40% meat'), pass `total_weight_g`, `fat_ratio_pct` and `preparation` INSTEAD of estimating — the server computes calories and macros deterministically from tissue composition, which is more accurate than estimating such cuts as one generic value.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Clean, short description of the food, e.g. 'two fried eggs'. Write it in the same language you're conversing in.",
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
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, defaults to today if omitted" },
      },
    },
  },
  {
    name: "update_entry",
    description: "Modify an existing food entry by id (e.g. correcting the quantity or description).",
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
    name: "end_conversation",
    description:
      "Call this when the user is clearly done talking (says goodbye, 'that's all', 'I'm done', etc). Say a brief goodbye in your reply text at the same time.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

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

        const entry = createEntry(userId, {
          // Spec: raw_transcript is what the user actually said — the real
          // turn text, not the model's cleaned description.
          raw_transcript: userTranscript ?? (input.description as string),
          description: input.description as string,
          ...nutrition,
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
