import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens SQLite at import time — point it at a throwaway file first.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-entries-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let entries: typeof import("../src/entries.js");

before(async () => {
  entries = await import("../src/entries.js");
});

describe("portion (grams) editing — 2026-09-15", () => {
  it("rescales calories and macros proportionally when the amount changes", () => {
    const e = entries.createEntry("u1", {
      raw_transcript: "200 grams of tomatoes",
      description: "Tomatoes",
      calories: 36,
      protein_g: 1.8,
      carbs_g: 7.8,
      fat_g: 0.4,
      food_key: "tomato",
      grams: 200,
      source: "verified",
      agreement_count: 5,
    });

    const updated = entries.updateEntry("u1", e.id, { grams: 120 })!;
    assert.equal(updated.grams, 120);
    assert.equal(updated.calories, 22, "36 * 120/200 = 21.6 → 22");
    assert.ok(Math.abs((updated.protein_g ?? 0) - 1.1) < 0.05, "1.8 * 0.6 = 1.08 → 1.1");
    assert.ok(Math.abs((updated.carbs_g ?? 0) - 4.7) < 0.05, "7.8 * 0.6 = 4.68 → 4.7");
    assert.equal(updated.edited, true);
  });

  it("keeps the food's provenance — a portion change is not a correction", () => {
    const e = entries.createEntry("u1", {
      raw_transcript: "x",
      description: "Rice",
      calories: 260,
      protein_g: 5,
      carbs_g: 56,
      fat_g: 0.6,
      food_key: "rice",
      grams: 200,
      source: "verified",
      agreement_count: 7,
    });

    const updated = entries.updateEntry("u1", e.id, { grams: 100 })!;
    assert.equal(updated.calories, 130);
    // A calorie correction would flip these to "yours"/null; a portion change
    // must leave them exactly as they were.
    assert.equal(updated.source, "verified");
    assert.equal(updated.agreement_count, 7);
  });

  it("does not rescale a per-item entry (grams is null)", () => {
    const e = entries.createEntry("u1", {
      raw_transcript: "an apple",
      description: "Apple",
      calories: 95,
      food_key: "apple",
      grams: null,
      source: "yours",
    });

    const updated = entries.updateEntry("u1", e.id, { grams: 200 })!;
    assert.equal(updated.calories, 95, "per-item nutrition is untouched by a grams field");
    assert.equal(updated.grams, null);
  });

  it("still treats an explicit calorie edit as a correction (source → yours)", () => {
    const e = entries.createEntry("u2", {
      raw_transcript: "y",
      description: "Homemade stew",
      calories: 400,
      grams: 300,
      food_key: "stew",
      source: "estimate",
    });

    const updated = entries.updateEntry("u2", e.id, { calories: 520 })!;
    assert.equal(updated.calories, 520);
    assert.equal(updated.source, "yours");
  });
});
