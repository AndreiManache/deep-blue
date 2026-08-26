import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";

// db.ts opens its SQLite file at import time, so point it at a throwaway file
// before importing anything that reaches it (auth.ts does).
const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "deepblue-auth-test-")), "test.db");
process.env.DEEPBLUE_DB_PATH = dbPath;
process.env.ANTHROPIC_API_KEY = "test-key";

let auth: typeof import("../src/auth.js");

before(async () => {
  auth = await import("../src/auth.js");
});

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const stored = auth.hashPassword("correct horse battery");
    assert.equal(auth.verifyPassword("correct horse battery", stored), true);
    assert.equal(auth.verifyPassword("wrong password", stored), false);
  });

  it("produces a different hash each time (random salt) but both verify", () => {
    const a = auth.hashPassword("same-password");
    const b = auth.hashPassword("same-password");
    assert.notEqual(a, b);
    assert.equal(auth.verifyPassword("same-password", a), true);
    assert.equal(auth.verifyPassword("same-password", b), true);
  });

  it("treats a malformed stored hash as a failed verify, never throwing", () => {
    assert.equal(auth.verifyPassword("anything", "not-a-valid-hash"), false);
    assert.equal(auth.verifyPassword("anything", ""), false);
  });
});

describe("credential validation", () => {
  it("accepts a reasonable username and password", () => {
    assert.equal(auth.validateCredentials("Andrei_23", "hunter2!!"), null);
  });

  it("rejects short usernames, bad characters, and short passwords", () => {
    assert.ok(auth.validateCredentials("ab", "longenough")); // too short
    assert.ok(auth.validateCredentials("has space", "longenough")); // bad char
    assert.ok(auth.validateCredentials("gooduser", "short")); // password < 8
    assert.ok(auth.validateCredentials(123, "longenough")); // non-string
  });
});

describe("accounts and sessions", () => {
  it("creates a user, logs in via a session token, and isolates identity by normalized username", () => {
    const user = auth.createUser("Maria", "s3cretpw!");
    assert.equal(user.id, "maria"); // normalized to lowercase
    assert.equal(user.username, "Maria"); // display casing preserved

    const token = auth.createSession(user.id);
    const resolved = auth.getSessionUser(token);
    assert.equal(resolved?.id, "maria");
    assert.equal(resolved?.username, "Maria");
  });

  it("rejects a duplicate username regardless of casing", () => {
    auth.createUser("Dupe", "password1");
    assert.throws(() => auth.createUser("dupe", "password2"), auth.UsernameTakenError);
  });

  it("returns null for unknown tokens and after logout", () => {
    const user = auth.createUser("logoutuser", "password1");
    const token = auth.createSession(user.id);
    assert.ok(auth.getSessionUser(token));
    auth.deleteSession(token);
    assert.equal(auth.getSessionUser(token), null);
    assert.equal(auth.getSessionUser("never-issued"), null);
    assert.equal(auth.getSessionUser(undefined), null);
  });

  it("extracts a bearer token from headers, preferring Authorization", () => {
    assert.equal(auth.tokenFromHeaders("Bearer abc123", undefined), "abc123");
    assert.equal(auth.tokenFromHeaders(undefined, "xyz"), "xyz");
    assert.equal(auth.tokenFromHeaders(undefined, undefined), undefined);
  });
});
