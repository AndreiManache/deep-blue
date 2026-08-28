import { SMALLESTAI_API_KEY } from "./config.js";

// Speech-to-text via Smallest AI's Pulse Pro model — English-only (confirmed
// against docs.smallest.ai's model card), so sttProvider.ts only ever calls
// this for a confirmed language:"en" profile. Chosen over the base
// multilingual "pulse" model specifically because Pulse Pro is the variant
// benchmarked (same ~2% WER as ElevenLabs Scribe v2, ~5x the throughput) —
// the multilingual model is a different model with unverified numbers.
export const SMALLESTAI_STT_MODEL = "pulse-pro";
const SMALLESTAI_STT_URL = `https://api.smallest.ai/waves/v1/stt/?model=${SMALLESTAI_STT_MODEL}&language=en`;

export interface SmallestTranscriptionResult {
  text: string;
}

// Takes the raw recorded audio bytes as-is (whatever container the browser's
// MediaRecorder produced — audio/webm;codecs=opus on Chrome/Android,
// audio/mp4 on iOS Safari) and uploads them as application/octet-stream per
// Smallest AI's docs. Their accepted-formats list (WAV/MP3/FLAC/Opus/raw
// PCM/etc.) doesn't explicitly confirm WebM or MP4 containers, so this is
// unverified against a real iOS-recorded clip until live-tested — the
// caller (sttProvider.ts) treats any failure here as non-fatal and retries
// via ElevenLabs on the same bytes.
export async function transcribeAudio(audio: Buffer): Promise<SmallestTranscriptionResult> {
  const res = await fetch(SMALLESTAI_STT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SMALLESTAI_API_KEY}`,
      "Content-Type": "application/octet-stream",
    },
    body: audio,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Smallest AI STT error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { transcription?: string };
  return { text: (data.transcription ?? "").trim() };
}
