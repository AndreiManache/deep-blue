import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

// Self-contained account auth: scrypt password hashing (no native deps —
// scrypt ships with Node), plus opaque DB-backed session tokens. Deliberately
// small; there's no email, no password reset, no roles. The account's id is
// the normalized username, which is also the user_id used everywhere else, so
// a person's food log and profile follow their login automatically.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

export interface User {
  id: string;
  username: string;
}

// --- username / password rules -------------------------------------------

// Normalized form is lowercased + trimmed; it's the account id and the
// per-user data key. Kept to a conservative charset so it's always a safe
// identifier and can never collide by mere casing.
const USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// Returns an error message, or null when acceptable. Validates the RAW input's
// length loosely and the NORMALIZED form strictly, so "  Andrei  " is fine but
// "a b" (space) or "ab" (too short) is rejected with a clear reason.
export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || typeof password !== "string") {
    return "Username and password are required.";
  }
  const normalized = normalizeUsername(username);
  if (!USERNAME_RE.test(normalized)) {
    return "Username must be 3–30 characters: letters, numbers, and . _ - only.";
  }
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password must be at most 200 characters.";
  return null;
}

// --- password hashing ------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN);
  // Lengths always match for a well-formed hash, but timingSafeEqual throws on
  // a mismatch, so guard it — a malformed stored value must read as "wrong",
  // never crash the request.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// --- users -----------------------------------------------------------------

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

export function findUser(username: string): (UserRow & { id: string }) | null {
  const id = normalizeUsername(username);
  const row = db.prepare(`SELECT id, username, password_hash FROM users WHERE id = ?`).get(id) as
    | UserRow
    | undefined;
  return row ?? null;
}

export class UsernameTakenError extends Error {}

// Creates the account and returns it. Throws UsernameTakenError if the
// normalized username already exists.
export function createUser(username: string, password: string): User {
  const id = normalizeUsername(username);
  if (findUser(id)) throw new UsernameTakenError("That username is already taken.");
  db.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    username.trim(),
    hashPassword(password),
    new Date().toISOString(),
  );
  return { id, username: username.trim() };
}

// --- sessions --------------------------------------------------------------

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare(`INSERT INTO auth_sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`).run(
    token,
    userId,
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
  );
  return token;
}

// Resolves a token to its user, or null if unknown/expired. Expired tokens are
// deleted on encounter, which doubles as lazy cleanup for abandoned sessions.
export function getSessionUser(token: string | undefined): User | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.expires_at AS expires_at, u.id AS id, u.username AS username
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`,
    )
    .get(token) as { expires_at: string; id: string; username: string } | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
    return null;
  }
  return { id: row.id, username: row.username };
}

export function deleteSession(token: string | undefined): void {
  if (!token) return;
  db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
}

// Pulls the bearer token out of the Authorization header (or the legacy
// X-Session-Token header, which the frontend may still send). Returns
// undefined when absent.
export function tokenFromHeaders(authorization?: string, xSessionToken?: string): string | undefined {
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  return xSessionToken?.trim() || undefined;
}

// --- admin -------------------------------------------------------------
//
// Deliberately not a real roles system (see the file header) — just an
// env-configured allowlist of user ids, same shape as the old ACCESS_CODES
// var. Set ADMIN_USERNAMES="andrei" (comma-separated for more than one) on
// the server; unset means nobody is an admin.
//
// Read lazily (not a module-load-time constant) — config.ts's dotenv.config()
// call must run first, and import order between this module and config.ts
// isn't guaranteed, so caching this at import time can silently see an empty
// process.env.ADMIN_USERNAMES.
export function isAdmin(userId: string): boolean {
  const admins = (process.env.ADMIN_USERNAMES ?? "")
    .split(",")
    .map((s) => normalizeUsername(s))
    .filter(Boolean);
  return admins.includes(userId);
}
