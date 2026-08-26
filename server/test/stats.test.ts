import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens its SQLite file at import time — point it at a throwaway file
// before importing anything that reaches it.
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-stats-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let getDailyStats: typeof import("../src/stats.js").getDailyStats;
let createEntry: typeof import("../src/entries.js").createEntry;
let db: typeof import("../src/db.js").db;

const USER = "statsuser";

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

// Insert with an explicit created_at (createEntry always stamps "now").
function insertAt(created_at: string, calories: number, protein_g: number | null) {
  db.prepare(
    `INSERT INTO food_entries (id, user_id, raw_transcript, description, calories, protein_g, carbs_g, fat_g, created_at, edited)
     VALUES (?, ?, 'x', 'x', ?, ?, NULL, NULL, ?, 0)`,
  ).run(randomUUID(), USER, calories, protein_g, created_at);
}

before(async () => {
  ({ getDailyStats } = await import("../src/stats.js"));
  ({ createEntry } = await import("../src/entries.js"));
  ({ db } = await import("../src/db.js"));

  // Two entries today (summed), one two days ago, nothing yesterday.
  createEntry(USER, { raw_transcript: "a", description: "a", calories: 500, protein_g: 30 });
  createEntry(USER, { raw_transcript: "b", description: "b", calories: 500, protein_g: 20 });
  insertAt(isoDaysAgo(2), 700, 40);
});

describe("getDailyStats", () => {
  it("returns a continuous series of the requested length, oldest first", () => {
    const days = getDailyStats(USER, 7);
    assert.equal(days.length, 7);
    // Oldest first, strictly increasing dates.
    for (let i = 1; i < days.length; i++) {
      assert.ok(days[i].date > days[i - 1].date, "dates should ascend");
    }
  });

  it("sums a day's entries and marks logged days", () => {
    const days = getDailyStats(USER, 7);
    const today = days[days.length - 1];
    assert.equal(today.logged, true);
    assert.equal(today.calories, 1000);
    assert.equal(today.protein_g, 50);
  });

  it("keeps days with no entries as logged:false with zero totals", () => {
    const days = getDailyStats(USER, 7);
    const yesterday = days[days.length - 2];
    assert.equal(yesterday.logged, false);
    assert.equal(yesterday.calories, 0);
    assert.equal(yesterday.protein_g, 0);

    const twoDaysAgo = days[days.length - 3];
    assert.equal(twoDaysAgo.logged, true);
    assert.equal(twoDaysAgo.calories, 700);
  });

  it("isolates by user — another user sees an empty series", () => {
    const days = getDailyStats("someone-else", 7);
    assert.equal(days.length, 7);
    assert.ok(days.every((d) => !d.logged && d.calories === 0));
  });
});
