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
