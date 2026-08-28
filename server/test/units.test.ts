import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import type { Interactions } from "@google/genai";
import { computeCompositionNutrition } from "../src/nutrition.js";
import { repairDanglingFunctionCall, truncateSteps } from "../src/geminiSessions.js";
import { repairDanglingToolUse, truncatePairSafe } from "../src/sessions.js";
import { MAX_HISTORY_TURNS } from "../src/config.js";
import { anthropicTools, geminiTools, toolDefs } from "../src/tools.js";
import { validateEntryPatch, validateProfileInput } from "../src/validation.js";

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
