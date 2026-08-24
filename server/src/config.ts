import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// .env lives at the project root (D:\DeepBlue\.env), one level above
// server/, not in the server package's own cwd — resolve it explicitly.
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });

export const PORT = Number(process.env.PORT ?? 3001);
// Named DEEPBLUE_USERNAME, not USERNAME — USERNAME is a built-in Windows
// env var (the OS login name) that already exists in process.env before
// dotenv runs, so dotenv silently ignores a plain "USERNAME" key in .env.
export const USERNAME = process.env.DEEPBLUE_USERNAME ?? "there";
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
// Shared secret gating every route except /health, once the app is reachable
// from the public internet. Empty means "no gate" — fine for local dev.
export const ACCESS_CODE = process.env.ACCESS_CODE ?? "";

// Single config value — bump to a Sonnet model name if Haiku's quality
// ever disappoints. No date suffix on this ID.
export const MODEL = "claude-haiku-4-5";

// Cap on stored conversation turns (user+assistant pairs), per spec §7.
export const MAX_HISTORY_MESSAGES = 20;

// Hard ceiling on tool-use round-trips within a single /chat turn.
export const MAX_TOOL_ITERATIONS = 5;

if (!ANTHROPIC_API_KEY) {
  console.warn(
    "[config] ANTHROPIC_API_KEY is not set — /chat requests will fail. Copy .env.example to .env and fill it in.",
  );
}
