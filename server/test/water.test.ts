import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens SQLite at import time — point it at a throwaway file first.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-water-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let water: typeof import("../src/water.js");

before(async () => {
  water = await import("../src/water.js");
});

describe("water tracking (2026-09-04, ticket #17)", () => {
  it("starts a fresh day at 0", () => {
    assert.equal(water.getWaterCount("u1"), 0);
  });

  it("addWater accumulates across multiple calls", () => {
    water.addWater("u2", 1);
    water.addWater("u2", 2);
    assert.equal(water.getWaterCount("u2"), 3);
  });

  it("addWater defaults an unspecified/invalid amount up to at least 1, never 0 or negative", () => {
    water.addWater("u3", 0);
    water.addWater("u3", -5);
    assert.equal(water.getWaterCount("u3"), 2, "each call still logs at least 1 glass");
  });

  it("addWater caps a single call at a sane maximum rather than trusting an absurd value", () => {
    water.addWater("u4", 999);
    assert.ok(water.getWaterCount("u4") < 999, "one call should never register hundreds of glasses");
  });

  it("setWaterToday replaces the day's total rather than adding to it", () => {
    water.addWater("u5", 3);
    water.setWaterToday("u5", 5);
    assert.equal(water.getWaterCount("u5"), 5);
    water.setWaterToday("u5", 2);
    assert.equal(water.getWaterCount("u5"), 2, "setting a lower level actually removes glasses, not just floors at the old total");
  });

  it("setWaterToday(0) clears the day back to zero", () => {
    water.addWater("u6", 4);
    water.setWaterToday("u6", 0);
    assert.equal(water.getWaterCount("u6"), 0);
  });

  it("users are isolated from each other", () => {
    water.addWater("u7", 3);
    water.addWater("u8", 1);
    assert.equal(water.getWaterCount("u7"), 3);
    assert.equal(water.getWaterCount("u8"), 1);
  });

  it("getWaterCount for an explicit past date ignores today's entries", () => {
    water.addWater("u9", 4); // logged "now" (today)
    assert.equal(water.getWaterCount("u9", "2020-01-01"), 0, "a date with no logged water reads as 0");
    assert.equal(water.getWaterCount("u9"), 4, "today's own total is unaffected");
  });
});
