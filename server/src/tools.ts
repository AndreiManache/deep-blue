import type Anthropic from "@anthropic-ai/sdk";
import { createEntry, deleteEntry, getEntriesForDate, updateEntry } from "./entries.js";
import { upsertProfile, type ProfileUpdateInput } from "./profile.js";

export const tools: Anthropic.Tool[] = [
  {
    name: "log_food",
    description:
      "Create a new food log entry. Use reasonable calorie/macro estimates for common foods — do not ask the user for exact numbers.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "Clean, short description of the food, e.g. 'two fried eggs'" },
        calories: { type: "number", description: "Estimated total calories" },
        protein_g: { type: "number", description: "Estimated grams of protein" },
        carbs_g: { type: "number", description: "Estimated grams of carbohydrates" },
        fat_g: { type: "number", description: "Estimated grams of fat" },
      },
      required: ["description", "calories"],
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
      "Create or update the user's profile: name, height, weight, age, biological sex, activity level, and fitness goal. Call this whenever the user states or changes any of this info by voice. All fields optional — only pass what changed.",
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

export function executeTool(name: string, input: Record<string, unknown>): ToolExecutionResult {
  try {
    switch (name) {
      case "log_food": {
        const entry = createEntry({
          raw_transcript: (input.raw_transcript as string | undefined) ?? (input.description as string),
          description: input.description as string,
          calories: input.calories as number,
          protein_g: input.protein_g as number | undefined,
          carbs_g: input.carbs_g as number | undefined,
          fat_g: input.fat_g as number | undefined,
        });
        return { content: JSON.stringify(entry), isError: false, mutated: true, ended: false };
      }
      case "get_entries": {
        const entries = getEntriesForDate(input.date as string | undefined);
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
        const updated = updateEntry(id, fields);
        if (!updated) {
          return { content: `No entry found with id ${id}`, isError: true, mutated: false, ended: false };
        }
        return { content: JSON.stringify(updated), isError: false, mutated: true, ended: false };
      }
      case "delete_entry": {
        const ok = deleteEntry(input.id as string);
        if (!ok) {
          return { content: `No entry found with id ${input.id}`, isError: true, mutated: false, ended: false };
        }
        return { content: "deleted", isError: false, mutated: true, ended: false };
      }
      case "update_profile": {
        const updated = upsertProfile(input as ProfileUpdateInput);
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
