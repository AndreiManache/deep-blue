import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import type { Interactions } from "@google/genai";
import { computeCompositionNutrition } from "../src/nutrition.js";
import { repairDanglingFunctionCall, truncateSteps } from "../src/geminiSessions.js";
import { computeTargets, type UserProfile } from "../src/profile.js";
import { repairDanglingToolUse, truncatePairSafe } from "../src/sessions.js";
import { MAX_HISTORY_TURNS } from "../src/config.js";
import { anthropicTools, geminiTools, toolDefs } from "../src/tools.js";
import { validateEntryPatch, validateFoodObservation, validateProfileInput } from "../src/validation.js";

// Every field computeTargets doesn't care about for a given case still has to
// be present to satisfy UserProfile — this is the base a test overrides.
function baseProfile(overrides: Partial<UserProfile>): UserProfile {
  return {
    name: null,
    height_cm: null,
    weight_kg: null,
    age: null,
    sex: null,
    activity_level: null,
    goal_type: null,
    goal_rate: null,
    goal_notes: null,
    language: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("computeCompositionNutrition", () => {
  it("matches the canonical pastramă case: 250g at 60% fat, cooked", () => {
    // 150g fat × 9 = 1350; 100g lean × 27% protein = 27g × 4 = 108 → 1458
    const result = computeCompositionNutrition({
      total_weight_g: 250,
      fat_ratio_pct: 60,
      preparation: "cooked",
    });
    assert.deepEqual(result, { calories: 1458, protein_g: 27, carbs_g: 0, fat_g: 150 });
  });

  it("never treats the full lean weight as protein", () => {
    const result = computeCompositionNutrition({ total_weight_g: 100, fat_ratio_pct: 0 });
    // The naive bug this replaces: 100g lean logged as 100g protein / 400 cal.
    assert.ok(result.protein_g < 35, `protein_g ${result.protein_g} should be a fraction of lean weight`);
    assert.ok(result.calories < 150);
  });

  it("protein fraction rises with moisture loss: raw < cooked < cured", () => {
    const at = (preparation: "raw" | "cooked" | "cured") =>
      computeCompositionNutrition({ total_weight_g: 200, fat_ratio_pct: 50, preparation }).protein_g;
    assert.ok(at("raw") < at("cooked"));
    assert.ok(at("cooked") < at("cured"));
  });

  it("100% fat is pure adipose: weight × 9", () => {
    const result = computeCompositionNutrition({ total_weight_g: 100, fat_ratio_pct: 100 });
    assert.deepEqual(result, { calories: 900, protein_g: 0, carbs_g: 0, fat_g: 100 });
  });

  it("defaults preparation to cooked", () => {
    const explicit = computeCompositionNutrition({
      total_weight_g: 250,
      fat_ratio_pct: 60,
      preparation: "cooked",
    });
    const defaulted = computeCompositionNutrition({ total_weight_g: 250, fat_ratio_pct: 60 });
    assert.deepEqual(defaulted, explicit);
  });
});

describe("computeTargets", () => {
  it("returns null with no profile", () => {
    assert.equal(computeTargets(null), null);
  });

  it("returns null when a required field is missing (age unset)", () => {
    const profile = baseProfile({
      height_cm: 180,
      weight_kg: 80,
      sex: "male",
      activity_level: "moderate",
      goal_type: "maintain",
    });
    assert.equal(computeTargets(profile), null);
  });

  it("Mifflin-St Jeor, male, maintain: matches hand-computed targets", () => {
    // BMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780; TDEE = 1780*1.55 = 2759
    const profile = baseProfile({
      height_cm: 180,
      weight_kg: 80,
      age: 30,
      sex: "male",
      activity_level: "moderate",
      goal_type: "maintain",
    });
    assert.deepEqual(computeTargets(profile), {
      bmr: 1780,
      tdee: 2759,
      calorie_target: 2759,
      protein_target_g: 144,
      fat_target_g: 83,
      carbs_target_g: 359,
    });
  });

  it("Mifflin-St Jeor, female, lose (moderate deficit): matches hand-computed targets", () => {
    // BMR = 10*60 + 6.25*165 - 5*25 - 161 = 1345.25; TDEE = 1345.25*1.2 = 1614.3
    // calorie_target = 1614.3 * (1 - 0.2) = 1291.44 -> 1291
    const profile = baseProfile({
      height_cm: 165,
      weight_kg: 60,
      age: 25,
      sex: "female",
      activity_level: "sedentary",
      goal_type: "lose",
      goal_rate: "moderate",
    });
    assert.deepEqual(computeTargets(profile), {
      bmr: 1345,
      tdee: 1614,
      calorie_target: 1291,
      protein_target_g: 108,
      fat_target_g: 39,
      carbs_target_g: 127,
    });
  });

  it("goal_rate defaults to moderate when unset", () => {
    const withDefault = computeTargets(
      baseProfile({
        height_cm: 165,
        weight_kg: 60,
        age: 25,
        sex: "female",
        activity_level: "sedentary",
        goal_type: "lose",
        goal_rate: null,
      }),
    );
    const explicit = computeTargets(
      baseProfile({
        height_cm: 165,
        weight_kg: 60,
        age: 25,
        sex: "female",
        activity_level: "sedentary",
        goal_type: "lose",
        goal_rate: "moderate",
      }),
    );
    assert.deepEqual(withDefault, explicit);
  });

  it("gain pushes the calorie target above maintenance", () => {
    const profile = baseProfile({
      height_cm: 180,
      weight_kg: 80,
      age: 30,
      sex: "male",
      activity_level: "moderate",
      goal_type: "gain",
      goal_rate: "moderate",
    });
    const targets = computeTargets(profile)!;
    assert.ok(targets.calorie_target > targets.tdee);
  });

  it("never returns negative carbs even for a very small deficit-heavy profile", () => {
    const profile = baseProfile({
      height_cm: 145,
      weight_kg: 40,
      age: 70,
      sex: "female",
      activity_level: "sedentary",
      goal_type: "lose",
      goal_rate: "aggressive",
    });
    const targets = computeTargets(profile)!;
    assert.ok(targets.carbs_target_g >= 0);
  });
});

describe("validateProfileInput", () => {
  it("accepts a normal partial update and nulls", () => {
    assert.equal(validateProfileInput({ weight_kg: 82.5, name: null, language: "ro" }), null);
    assert.equal(validateProfileInput({}), null);
  });

  it("rejects out-of-range numbers before they reach the BMR formula", () => {
    assert.match(validateProfileInput({ weight_kg: 700 })!, /weight_kg/);
    assert.match(validateProfileInput({ height_cm: 20 })!, /height_cm/);
    assert.match(validateProfileInput({ age: NaN })!, /age/);
  });

  it("rejects out-of-enum strings", () => {
    assert.match(validateProfileInput({ sex: "yes" })!, /sex/);
    assert.match(validateProfileInput({ activity_level: "extreme" })!, /activity_level/);
    assert.match(validateProfileInput({ language: "de" })!, /language/);
  });
});

describe("validateEntryPatch", () => {
  it("accepts a normal edit", () => {
    assert.equal(validateEntryPatch({ description: "two eggs", calories: 180 }), null);
  });

  it("rejects garbage that would previously have reached SQLite", () => {
    assert.match(validateEntryPatch({ calories: "abc" as unknown as number })!, /calories/);
    assert.match(validateEntryPatch({ description: "   " })!, /description/);
    assert.match(validateEntryPatch({ protein_g: -5 })!, /protein_g/);
  });
});

describe("validateFoodObservation", () => {
  it("accepts a normal entry", () => {
    assert.equal(
      validateFoodObservation({ food_key: "greek yogurt", basis: "per_100g", calories: 59, protein_g: 10 }),
      null,
    );
  });

  it("rejects a missing/empty food_key", () => {
    assert.match(validateFoodObservation({ basis: "per_100g", calories: 59 })!, /food_key/);
    assert.match(validateFoodObservation({ food_key: "   ", basis: "per_100g", calories: 59 })!, /food_key/);
  });

  it("rejects an out-of-enum basis", () => {
    assert.match(
      validateFoodObservation({ food_key: "x", basis: "per_kg" as unknown as string, calories: 59 })!,
      /basis/,
    );
  });

  it("rejects out-of-range calories", () => {
    assert.match(validateFoodObservation({ food_key: "x", basis: "per_100g", calories: -1 })!, /calories/);
    assert.match(validateFoodObservation({ food_key: "x", basis: "per_100g", calories: 5000 })!, /calories/);
  });
});

describe("truncatePairSafe", () => {
  const userTurn = (i: number): Anthropic.MessageParam => ({ role: "user", content: `turn ${i}` });
  const assistantText = (i: number): Anthropic.MessageParam => ({
    role: "assistant",
    content: [{ type: "text", text: `reply ${i}` }],
  });
  const toolUse = (i: number): Anthropic.MessageParam => ({
    role: "assistant",
    content: [{ type: "tool_use", id: `t${i}`, name: "get_entries", input: {} }],
  });
  const toolResult = (i: number): Anthropic.MessageParam => ({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "[]" }],
  });

  it("leaves short histories untouched", () => {
    const history = [userTurn(1), assistantText(1), userTurn(2), assistantText(2)];
    assert.equal(truncatePairSafe(history), history);
  });

  it("keeps the last MAX_HISTORY_TURNS genuine turns even when tool traffic inflates the message count", () => {
    // Every turn costs 4 messages: user, tool_use, tool_result, assistant.
    const history: Anthropic.MessageParam[] = [];
    const total = MAX_HISTORY_TURNS + 10;
    for (let i = 0; i < total; i++) {
      history.push(userTurn(i), toolUse(i), toolResult(i), assistantText(i));
    }

    const truncated = truncatePairSafe(history);
    const genuineTurns = truncated.filter(
      (m) => m.role === "user" && typeof m.content === "string",
    );
    assert.equal(genuineTurns.length, MAX_HISTORY_TURNS);
    // Must start on a genuine user turn — never an assistant message or a
    // tool_result carrier orphaned from its tool_use.
    assert.equal(truncated[0].role, "user");
    assert.equal(typeof truncated[0].content, "string");
    assert.equal(truncated[0].content, `turn ${total - MAX_HISTORY_TURNS}`);
  });
});

describe("repairDanglingToolUse", () => {
  const userTurn = (i: number): Anthropic.MessageParam => ({ role: "user", content: `turn ${i}` });
  const assistantText = (i: number): Anthropic.MessageParam => ({
    role: "assistant",
    content: [{ type: "text", text: `reply ${i}` }],
  });
  const toolUse = (i: number): Anthropic.MessageParam => ({
    role: "assistant",
    content: [{ type: "tool_use", id: `t${i}`, name: "get_entries", input: {} }],
  });
  const toolResult = (i: number): Anthropic.MessageParam => ({
    role: "user",
    content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "[]" }],
  });

  it("drops a trailing assistant tool_use with no matching tool_result", () => {
    const history = [userTurn(1), assistantText(1), userTurn(2), toolUse(2)];
    const repaired = repairDanglingToolUse(history);
    assert.equal(repaired.length, 3);
    assert.deepEqual(repaired, history.slice(0, 3));
  });

  it("leaves a well-formed history (tool_use already paired) untouched", () => {
    const history = [userTurn(1), toolUse(1), toolResult(1), assistantText(1)];
    assert.equal(repairDanglingToolUse(history), history);
  });

  it("leaves a history ending in a genuine user turn untouched", () => {
    const history = [userTurn(1), assistantText(1), userTurn(2)];
    assert.equal(repairDanglingToolUse(history), history);
  });

  it("is a no-op on an empty history", () => {
    assert.deepEqual(repairDanglingToolUse([]), []);
  });
});

describe("tool schema derivation (Anthropic/Gemini drift guard)", () => {
  it("derives the same tool names, in the same order, for both providers", () => {
    const names = toolDefs.map((t) => t.name);
    assert.deepEqual(anthropicTools.map((t) => t.name), names);
    assert.deepEqual(geminiTools.map((t) => t.name), names);
  });

  it("carries the same description and parameters through to both shapes", () => {
    for (const def of toolDefs) {
      const a = anthropicTools.find((t) => t.name === def.name)!;
      const g = geminiTools.find((t) => t.name === def.name)!;
      assert.equal(a.description, def.description);
      assert.equal(g.description, def.description);
      assert.deepEqual(a.input_schema, def.parameters);
      assert.deepEqual(g.parameters, def.parameters);
      assert.equal(g.type, "function");
    }
  });
});

describe("truncateSteps (Gemini)", () => {
  const userInput = (text: string): Interactions.Step => ({
    type: "user_input",
    content: [{ type: "text", text }],
  });
  const modelOutput = (text: string): Interactions.Step => ({
    type: "model_output",
    content: [{ type: "text", text }],
  });
  const functionCall = (id: string): Interactions.Step => ({
    type: "function_call",
    id,
    name: "get_entries",
    arguments: {},
  });
  const functionResult = (id: string): Interactions.Step => ({
    type: "function_result",
    call_id: id,
    result: "[]",
  });

  it("leaves short histories untouched", () => {
    const steps = [userInput("turn 1"), modelOutput("reply 1"), userInput("turn 2"), modelOutput("reply 2")];
    assert.equal(truncateSteps(steps), steps);
  });

  it("keeps the last MAX_HISTORY_TURNS user turns even when tool traffic inflates the step count", () => {
    const steps: Interactions.Step[] = [];
    const total = MAX_HISTORY_TURNS + 10;
    for (let i = 0; i < total; i++) {
      steps.push(userInput(`turn ${i}`), functionCall(`t${i}`), functionResult(`t${i}`), modelOutput(`reply ${i}`));
    }
    const truncated = truncateSteps(steps);
    const genuineTurns = truncated.filter((s) => s.type === "user_input");
    assert.equal(genuineTurns.length, MAX_HISTORY_TURNS);
    assert.equal(truncated[0].type, "user_input");
  });
});

describe("repairDanglingFunctionCall (Gemini)", () => {
  it("drops a trailing function_call with no matching function_result", () => {
    const steps: Interactions.Step[] = [
      { type: "user_input", content: [{ type: "text", text: "turn 1" }] },
      { type: "function_call", id: "c1", name: "get_entries", arguments: {} },
    ];
    const repaired = repairDanglingFunctionCall(steps);
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].type, "user_input");
  });

  it("leaves a well-formed history untouched", () => {
    const steps: Interactions.Step[] = [
      { type: "user_input", content: [{ type: "text", text: "turn 1" }] },
      { type: "function_call", id: "c1", name: "get_entries", arguments: {} },
      { type: "function_result", call_id: "c1", result: "[]" },
      { type: "model_output", content: [{ type: "text", text: "reply 1" }] },
    ];
    assert.equal(repairDanglingFunctionCall(steps), steps);
  });

  it("is a no-op on an empty history", () => {
    assert.deepEqual(repairDanglingFunctionCall([]), []);
  });
});
