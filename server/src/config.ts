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

// Maps a shared access code to the user identity it belongs to — e.g.
// "andrei23:andrei,Maria:maria" grants two people their own isolated
// profile/food-log data on the same deployment. Empty means "no gate" —
// every request resolves to the fixed "andrei" identity, fine for local dev.
export const ACCESS_CODES: Map<string, string> = new Map(
  (process.env.ACCESS_CODES ?? "")
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [code, userId] = pair.split(":").map((s) => s.trim());
      return [code, userId] as [string, string];
    })
    .filter(([code, userId]) => code && userId),
);

// Empty means "no ElevenLabs" — reply audio synthesis is skipped and the
// frontend falls back to the browser's own speechSynthesis. Never required.
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
// "Rachel" — a well-known warm, conversational premade voice. Swappable.
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
// Optional dedicated voice for Romanian — eleven_flash_v2_5 is multilingual
// and can already speak Romanian with ELEVENLABS_VOICE_ID, so this is purely
// an upgrade slot if a specifically Romanian-sounding voice is preferred.
// Falls back to ELEVENLABS_VOICE_ID when unset.
export const ELEVENLABS_VOICE_ID_RO = process.env.ELEVENLABS_VOICE_ID_RO || ELEVENLABS_VOICE_ID;
// Fastest + cheapest ElevenLabs model (~75ms synthesis, 50% lower per-char
// cost than the default) — the right tradeoff for short conversational replies.
// Also multilingual (32 languages, including Romanian).
export const ELEVENLABS_MODEL_ID = "eleven_flash_v2_5";

// Single config value. Upgraded from claude-haiku-4-5 (2026-08-25) for
// estimation accuracy — Haiku applied the multi-step composition rule only
// ~75% of the time. ~3x per-token cost, still a few dollars/month at this
// usage. No date suffix on this ID.
export const MODEL = "claude-sonnet-5";

// Cap on stored conversation turns — genuine user turns, per spec §7. Tool
// round-trips add extra messages that don't count against this.
export const MAX_HISTORY_TURNS = 20;

// Hard ceiling on tool-use round-trips within a single /chat turn.
export const MAX_TOOL_ITERATIONS = 5;

if (!ANTHROPIC_API_KEY) {
  console.warn(
    "[config] ANTHROPIC_API_KEY is not set — /chat requests will fail. Copy .env.example to .env and fill it in.",
  );
}
