import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type Anthropic from "@anthropic-ai/sdk";
import { computeCompositionNutrition } from "../src/nutrition.js";
import { truncatePairSafe } from "../src/sessions.js";
import { MAX_HISTORY_TURNS } from "../src/config.js";
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
