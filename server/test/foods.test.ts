import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens SQLite at import time — point it at a throwaway file first.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-foods-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let foods: typeof import("../src/foods.js");

const per100 = (calories: number) => ({ calories, protein_g: null, carbs_g: null, fat_g: null });

before(async () => {
  foods = await import("../src/foods.js");
});

describe("per-basis conversion", () => {
  it("round-trips total <-> per-100g", () => {
    const { basis, nutrition } = foods.perBasisFromTotal(per100(900), 200);
    assert.equal(basis, "per_100g");
    assert.equal(nutrition.calories, 450);
    assert.equal(foods.totalFromBasis(nutrition, "per_100g", 200).calories, 900);
  });

  it("falls back to per-item when grams are unknown", () => {
    const { basis, nutrition } = foods.perBasisFromTotal(per100(139), null);
    assert.equal(basis, "per_item");
    assert.equal(nutrition.calories, 139);
  });
});

describe("crowd consensus", () => {
  it("verifies once 5 users' values agree, at the cluster median", () => {
    const key = "test crackers";
    for (const [user, cal] of [
      ["u1", 450],
      ["u2", 460],
      ["u3", 440],
      ["u4", 455],
    ] as const) {
      foods.recordObservation(user, key, "per_100g", per100(cal), "estimate");
    }
    assert.equal(foods.getConsensus(key), null, "4 users is not enough");

    foods.recordObservation("u5", key, "per_100g", per100(445), "estimate");
    const consensus = foods.getConsensus(key);
    assert.ok(consensus, "5 agreeing users -> verified");
    assert.equal(consensus.agreementCount, 5);
    assert.ok(Math.abs(consensus.nutrition.calories - 450) <= 10);
  });

  it("does not verify when values are scattered", () => {
    const key = "scattered food";
    for (const [user, cal] of [
      ["u1", 450],
      ["u2", 900],
      ["u3", 200],
      ["u4", 460],
      ["u5", 445],
    ] as const) {
      foods.recordObservation(user, key, "per_100g", per100(cal), "estimate");
    }
    // median 450; only 450/460/445 fall within ±15% -> 3 < 5.
    assert.equal(foods.getConsensus(key), null);
  });
});

describe("resolveNutrition priority", () => {
  it("prefers the user's own value, then verified, then the model", () => {
    const key = "resolve food";
    // Five users agree at ~500.
    for (const [user, cal] of [
      ["a", 500],
      ["b", 510],
      ["c", 490],
      ["d", 505],
      ["e", 495],
    ] as const) {
      foods.recordObservation(user, key, "per_100g", per100(cal), "estimate");
    }

    // A brand-new user gets the verified value, not their model guess.
    const fresh = foods.resolveNutrition("newbie", key, "per_100g", per100(700));
    assert.equal(fresh.source, "verified");
    assert.ok(Math.abs(fresh.nutrition.calories - 500) <= 15);

    // User 'a' has their own value -> 'yours'.
    const own = foods.resolveNutrition("a", key, "per_100g", per100(700));
    assert.equal(own.source, "yours");
    assert.equal(own.nutrition.calories, 500);
  });

  it("backfills a missing macro on the remembered value from this turn's fresh estimate, without touching calories", () => {
    const key = "protein bar";
    // First-ever log: the model only estimated calories, no macros.
    foods.recordObservation("maria", key, "per_item", { calories: 320, protein_g: 20, carbs_g: null, fat_g: null }, "estimate");

    // A later log where the model DOES estimate carbs/fat this time.
    const r = foods.resolveNutrition(
      "maria",
      key,
      "per_item",
      { calories: 340, protein_g: 22, carbs_g: 35, fat_g: 12 },
    );
    assert.equal(r.source, "yours");
    assert.equal(r.nutrition.calories, 320, "calories stays the remembered value, not the fresh guess");
    assert.equal(r.nutrition.protein_g, 20, "protein was already present, stays the remembered value");
    assert.equal(r.nutrition.carbs_g, 35, "carbs was null, backfilled from the fresh estimate");
    assert.equal(r.nutrition.fat_g, 12, "fat was null, backfilled from the fresh estimate");
  });

  it("a correction outranks and is not overwritten by a later estimate", () => {
    const key = "correction food";
    foods.recordObservation("z", key, "per_100g", per100(450), "estimate");
    foods.recordObservation("z", key, "per_100g", per100(600), "correction");
    // A later estimate must not clobber the correction.
    foods.recordObservation("z", key, "per_100g", per100(480), "estimate");
    const r = foods.resolveNutrition("z", key, "per_100g", per100(300));
    assert.equal(r.source, "yours");
    assert.equal(r.nutrition.calories, 600);
  });
});

describe("recipes and favorites (2026-09-03)", () => {
  it("createRecipe marks is_recipe on a brand-new food, leaving is_favorite unset", () => {
    const key = "my protein shake";
    foods.createRecipe("andrei", key, "per_item", { calories: 320, protein_g: 40, carbs_g: 10, fat_g: 5 });
    const row = foods.listUserObservations("andrei").find((o) => o.food_key === key);
    assert.ok(row, "recipe was saved");
    assert.equal(row!.is_recipe, 1);
    assert.equal(row!.is_favorite, 0);
    assert.equal(row!.calories, 320);
  });

  it("setFavorite stars an existing observation without touching is_recipe", () => {
    const key = "yogurt with granola";
    foods.recordObservation("andrei", key, "per_100g", per100(150), "estimate");
    const starred = foods.setFavorite("andrei", key, true);
    assert.equal(starred, true);
    const row = foods.listUserObservations("andrei").find((o) => o.food_key === key);
    assert.equal(row!.is_favorite, 1);
    assert.equal(row!.is_recipe, 0, "favoriting a logged food never makes it a recipe");
  });

  it("setFavorite on a food never logged returns false — nothing to star", () => {
    assert.equal(foods.setFavorite("andrei", "never logged this", true), false);
  });

  it("re-logging a favorited food does not un-favorite it", () => {
    const key = "morning coffee";
    foods.recordObservation("andrei", key, "per_100g", per100(5), "estimate");
    foods.setFavorite("andrei", key, true);
    // Logging it again later (a real turn re-recording the same food).
    foods.recordObservation("andrei", key, "per_100g", per100(6), "estimate");
    const row = foods.listUserObservations("andrei").find((o) => o.food_key === key);
    assert.equal(row!.is_favorite, 1, "favorite status survives being logged again");
    assert.equal(row!.calories, 6, "the fresh estimate still updates the numbers");
  });

  it("creating a recipe over an already-favorited food_key keeps it favorited", () => {
    const key = "grandma's soup";
    foods.recordObservation("andrei", key, "per_100g", per100(80), "estimate");
    foods.setFavorite("andrei", key, true);
    foods.createRecipe("andrei", key, "per_100g", { calories: 90, protein_g: 3, carbs_g: 8, fat_g: 2 });
    const row = foods.listUserObservations("andrei").find((o) => o.food_key === key);
    assert.equal(row!.is_recipe, 1);
    assert.equal(row!.is_favorite, 1, "naming it a recipe doesn't clobber the existing favorite flag");
    assert.equal(row!.calories, 90);
  });

  it("listNamedFoods returns only recipes/favorites, not ordinary logged foods", () => {
    const userId = "priya";
    foods.recordObservation(userId, "an ordinary snack", "per_100g", per100(200), "estimate");
    foods.createRecipe(userId, "priya's dal", "per_item", { calories: 400, protein_g: 20, carbs_g: 50, fat_g: 10 });
    foods.recordObservation(userId, "iced coffee", "per_100g", per100(5), "estimate");
    foods.setFavorite(userId, "iced coffee", true);

    const named = foods.listNamedFoods(userId).map((f) => f.food_key);
    assert.deepEqual(new Set(named), new Set(["priya's dal", "iced coffee"]));
    assert.ok(!named.includes("an ordinary snack"), "a plain logged food with neither flag is excluded");
  });

  it("a saved recipe's basis wins even when this turn's estimate lands on a different basis", () => {
    const key = "zurna kebab de pui";
    foods.createRecipe("andrei2", key, "per_item", { calories: 1658, protein_g: 50, carbs_g: 74, fat_g: 72 });

    // This turn the model also guessed a portion weight, which derives
    // per_100g instead of per_item — the saved recipe must still apply.
    const { basis: modelBasis, nutrition: modelPerBasis } = foods.perBasisFromTotal(
      { calories: 750, protein_g: 45, carbs_g: 75, fat_g: 30 },
      450,
    );
    assert.equal(modelBasis, "per_100g");

    const resolved = foods.resolveNutrition("andrei2", key, modelBasis, modelPerBasis);
    assert.equal(resolved.source, "yours");
    assert.equal(resolved.basis, "per_item");
    assert.equal(resolved.nutrition.calories, 1658);

    const total = foods.totalFromBasis(resolved.nutrition, resolved.basis, 450);
    assert.equal(total.calories, 1658, "the recipe's fixed total, not scaled by the guessed portion weight");
  });
});
