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

// Back to Haiku 4.5 (2026-08-26) for speed and cost. It was upgraded to
// Sonnet on 2026-08-25 because Haiku applied the multi-step composition rule
// inconsistently — but that math now lives in deterministic code (log_food
// computes the fat/lean split server-side), so Haiku's weakness there no
// longer applies. Haiku is ~2x cheaper ($1/$5 vs $2/$10 per 1M tokens) and
// noticeably faster per turn — the right tradeoff for short voice replies.
// No date suffix on this ID.
export const MODEL = "claude-haiku-4-5";

// Used only for turns with a photo attached (log-by-photo). Vision food
// recognition is a harder, less frequent task than routine text logging, so
// it gets the better model — Haiku stays the default for everything else.
export const MODEL_VISION = "claude-sonnet-5";

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
