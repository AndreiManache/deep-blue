import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens SQLite at import time — point it at a throwaway file first.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-fooddb-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.USDA_API_KEY = ""; // disable USDA — these tests must not hit the network

let foodDb: typeof import("../src/foodDb.js");
let tools: typeof import("../src/tools.js");
let db: typeof import("../src/db.js").db;

before(async () => {
  foodDb = await import("../src/foodDb.js");
  tools = await import("../src/tools.js");
  db = (await import("../src/db.js")).db;
  foodDb.seedCuratedFoods();
});

describe("authoritative food DB — resolution (2026-09-17)", () => {
  it("cooking state routing from the model's method word", () => {
    assert.equal(foodDb.cookingStateFromMethod("raw"), "raw");
    assert.equal(foodDb.cookingStateFromMethod("boiled"), "cooked");
    assert.equal(foodDb.cookingStateFromMethod("grilled"), "cooked");
    assert.equal(foodDb.cookingStateFromMethod("air-fried"), "cooked");
    assert.equal(foodDb.cookingStateFromMethod(undefined), "n/a");
    assert.equal(foodDb.cookingStateFromMethod("none"), "n/a");
  });

  it("resolves raw vs cooked chicken from the curated seed, scaled by grams", () => {
    const raw = foodDb.resolveDensity("chicken breast", "raw", 100)!;
    assert.equal(raw.nutrition.calories, 120);
    const cooked = foodDb.resolveDensity("chicken breast", "cooked", 200)!;
    assert.equal(cooked.nutrition.calories, 330, "165/100g * 200g");
    assert.equal(cooked.verified, true);
    assert.equal(cooked.confidence, "high");
  });

  it("falls back through a stripped generic key ('grilled chicken breast' -> 'chicken breast')", () => {
    const hit = foodDb.resolveDensity("grilled chicken breast", "cooked", 100);
    assert.ok(hit, "should still resolve via the stripped generic key");
    assert.equal(hit!.nutrition.calories, 165);
  });

  it("confidence bands produce a range", () => {
    assert.deepEqual(foodDb.calorieRange(300, "high"), { low: 276, high: 324 });
    assert.deepEqual(foodDb.calorieRange(300, "low"), { low: 225, high: 375 });
  });

  it("recordModelFallback stores a low-confidence llm row for review, without clobbering curated", () => {
    foodDb.recordModelFallback("some novel dish", "n/a", "per_100g", {
      calories: 200,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
    });
    const row = db
      .prepare("SELECT source, confidence, needs_review FROM food_density WHERE food_key = ? AND cooking_state = ?")
      .get("some novel dish", "n/a") as { source: string; confidence: string; needs_review: number };
    assert.equal(row.source, "llm");
    assert.equal(row.confidence, "low");
    assert.equal(row.needs_review, 1);

    // Must not overwrite a curated row.
    foodDb.recordModelFallback("chicken breast", "cooked", "per_100g", { calories: 999, protein_g: 1, carbs_g: 1, fat_g: 1 });
    const chicken = db
      .prepare("SELECT calories, source FROM food_density WHERE food_key = ? AND cooking_state = ?")
      .get("chicken breast", "cooked") as { calories: number; source: string };
    assert.equal(chicken.source, "curated");
    assert.equal(chicken.calories, 165);
  });
});

describe("authoritative food DB — admin CRUD", () => {
  it("verify clears the review flag; delete removes the row; review-queue rows list first", () => {
    foodDb.recordModelFallback("review me", "n/a", "per_100g", { calories: 150, protein_g: 5, carbs_g: 10, fat_g: 3 });
    assert.equal(foodDb.reviewQueueCount() >= 1, true);

    const before = foodDb.listDensities();
    assert.equal(before[0]!.needs_review, 1, "needs_review rows sort to the top");

    assert.equal(foodDb.verifyDensity("review me", "n/a"), true);
    const row = db
      .prepare("SELECT verified, needs_review FROM food_density WHERE food_key = ? AND cooking_state = ?")
      .get("review me", "n/a") as { verified: number; needs_review: number };
    assert.equal(row.verified, 1);
    assert.equal(row.needs_review, 0);

    // Admin upsert overrides an AI row with a verified admin value.
    foodDb.upsertDensity({
      food_key: "review me",
      cooking_state: "n/a",
      nutrition: { calories: 200, protein_g: 8, carbs_g: 12, fat_g: 4 },
      source: "admin",
      confidence: "high",
      verified: true,
    });
    const admin = foodDb.lookupDensity("review me", "n/a")!;
    assert.equal(admin.source, "admin");
    assert.equal(admin.calories, 200);

    assert.equal(foodDb.deleteDensity("review me", "n/a"), true);
    assert.equal(foodDb.lookupDensity("review me", "n/a"), undefined);
    assert.equal(foodDb.deleteDensity("review me", "n/a"), false, "already gone");
  });
});

describe("authoritative food DB — log_food integration", () => {
  it("uses the DB value, not the model's wrong estimate", async () => {
    // Model wildly over-estimates 200g grilled chicken at 999 kcal; the DB says 330.
    const res = await tools.executeTool("u1", "log_food", {
      description: "grilled chicken",
      food_key: "chicken breast",
      grams: 200,
      calories: 999,
      protein_g: 1,
      carbs_g: 1,
      fat_g: 1,
      cooking_method: "grilled",
    });
    assert.equal(res.isError, false);
    const entry = JSON.parse(res.content);
    assert.equal(entry.calories, 330, "resolved from the authoritative DB, not the 999 guess");
    assert.equal(entry.source, "verified");
    assert.equal(entry.confidence, "high");
    assert.ok(entry.calorie_range && entry.calorie_range.low < 330 && entry.calorie_range.high > 330);
  });

  it("stores an unknown food from the model estimate, then reuses the DB for the next user", async () => {
    const first = JSON.parse(
      (
        await tools.executeTool("u1", "log_food", {
          description: "zurna kebab",
          food_key: "zurna kebab",
          grams: 300,
          calories: 600,
          protein_g: 30,
          carbs_g: 40,
          fat_g: 30,
        })
      ).content,
    );
    assert.equal(first.source, "estimate");
    assert.equal(first.confidence, "low");

    // It's now in the DB, flagged for review.
    const stored = db
      .prepare("SELECT source, needs_review FROM food_density WHERE food_key = ? AND cooking_state = ?")
      .get("zurna kebab", "n/a") as { source: string; needs_review: number };
    assert.equal(stored.source, "llm");
    assert.equal(stored.needs_review, 1);

    // A DIFFERENT user logging the same food, even with a different guess, now
    // resolves from the stored DB value (300g -> the same 600), no re-guessing.
    const second = JSON.parse(
      (
        await tools.executeTool("u2", "log_food", {
          description: "zurna kebab",
          food_key: "zurna kebab",
          grams: 300,
          calories: 900,
          protein_g: 1,
          carbs_g: 1,
          fat_g: 1,
        })
      ).content,
    );
    assert.equal(second.calories, 600, "reused the stored DB value, not u2's 900 guess");
  });
});
