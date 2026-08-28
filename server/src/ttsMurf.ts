import { MURF_API_KEY } from "./config.js";

// Text-to-speech via Murf's Falcon 2 model — live-verified against the real
// API: it returns audio bytes directly as the HTTP response body (no JSON
// wrapper, no base64), with Content-Type reflecting the requested format.
// Requested as WAV here since that's a format the client already knows how
// to play (see synthesis.ts) — no PCM-wrapping hack needed, unlike Gemini's
// TTS (see ttsGemini.ts).
const MURF_STREAM_URL = "https://api.murf.ai/v1/speech/stream";

export interface MurfTtsResult {
  audio_base64: string | null;
  audio_mime: string;
}

export async function synthesizeSpeech(text: string, voiceId: string): Promise<MurfTtsResult> {
  const fallback: MurfTtsResult = { audio_base64: null, audio_mime: "audio/wav" };
  if (!MURF_API_KEY || !text.trim()) return fallback;

  const res = await fetch(MURF_STREAM_URL, {
    method: "POST",
    headers: {
      "api-key": MURF_API_KEY,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      text,
      voiceId,
      model: "falcon-2",
      sampleRate: 24000,
      format: "WAV",
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Murf TTS error ${res.status}: ${body}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  return { audio_base64: audio.toString("base64"), audio_mime: res.headers.get("content-type") ?? "audio/wav" };
}
