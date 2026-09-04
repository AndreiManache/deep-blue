import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens SQLite at import time — point it at a throwaway file first.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-workouts-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let workouts: typeof import("../src/workouts.js");

before(async () => {
  workouts = await import("../src/workouts.js");
});

describe("workout logging (2026-09-04, ticket #18)", () => {
  it("logs a workout and reads it back for today", () => {
    const entry = workouts.logWorkout("u1", { raw_transcript: "I ran for 30 minutes", description: "30 minute run", duration_minutes: 30 });
    assert.equal(entry.description, "30 minute run");
    assert.equal(entry.duration_minutes, 30);

    const today = workouts.getWorkoutsForDate("u1");
    assert.equal(today.length, 1);
    assert.equal(today[0]!.id, entry.id);
  });

  it("duration_minutes is optional and stays null when omitted", () => {
    const entry = workouts.logWorkout("u2", { raw_transcript: "did some yoga", description: "yoga session" });
    assert.equal(entry.duration_minutes, null);
  });

  it("multiple workouts on the same day are all returned, oldest first", () => {
    workouts.logWorkout("u3", { raw_transcript: "a run", description: "run", duration_minutes: 20 });
    workouts.logWorkout("u3", { raw_transcript: "the gym", description: "gym", duration_minutes: 45 });
    const today = workouts.getWorkoutsForDate("u3");
    assert.equal(today.length, 2);
    assert.equal(today[0]!.description, "run");
    assert.equal(today[1]!.description, "gym");
  });

  it("users are isolated from each other", () => {
    workouts.logWorkout("u4", { raw_transcript: "a swim", description: "swim" });
    assert.equal(workouts.getWorkoutsForDate("u5").length, 0);
    assert.equal(workouts.getWorkoutsForDate("u4").length, 1);
  });

  it("getWorkoutsForDate for an explicit past date ignores today's entries", () => {
    workouts.logWorkout("u6", { raw_transcript: "today's run", description: "run" });
    assert.equal(workouts.getWorkoutsForDate("u6", "2020-01-01").length, 0);
    assert.equal(workouts.getWorkoutsForDate("u6").length, 1);
  });

  it("deleteWorkout removes it and returns true, false when it's already gone", () => {
    const entry = workouts.logWorkout("u7", { raw_transcript: "a walk", description: "walk" });
    assert.equal(workouts.deleteWorkout("u7", entry.id), true);
    assert.equal(workouts.getWorkoutsForDate("u7").length, 0);
    assert.equal(workouts.deleteWorkout("u7", entry.id), false, "deleting again finds nothing left to delete");
  });

  it("deleteWorkout can't delete another user's entry", () => {
    const entry = workouts.logWorkout("u8", { raw_transcript: "a run", description: "run" });
    assert.equal(workouts.deleteWorkout("u9", entry.id), false);
    assert.equal(workouts.getWorkoutsForDate("u8").length, 1, "the entry survives the other user's failed delete attempt");
  });
});
