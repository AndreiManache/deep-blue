import { ELEVENLABS_API_KEY } from "./config.js";

// Speech-to-text via ElevenLabs Scribe, reusing the same key as TTS. The
// client records the user's turn (getUserMedia + MediaRecorder) and POSTs the
// audio here; we forward it to ElevenLabs and return the transcript. This
// replaces the browser's flaky webkitSpeechRecognition, which on iOS kept
// getting starved of audio after the AI spoke.

export const STT_MODEL_ID = "scribe_v2";

export class SttNotConfiguredError extends Error {}

export interface TranscriptionResult {
  text: string;
  language_code?: string;
}

// Transcribes an audio buffer. Throws SttNotConfiguredError when no key is set
// (the caller maps that to a clear 503), and a plain Error on an upstream
// failure. languageCode is an optional ISO-639 hint; omitted, Scribe
// auto-detects (reliable enough for short utterances, and avoids guessing a
// code format the API might reject).
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  languageCode?: string,
): Promise<TranscriptionResult> {
  if (!ELEVENLABS_API_KEY) throw new SttNotConfiguredError("ElevenLabs key not configured");

  const form = new FormData();
  form.append("model_id", STT_MODEL_ID);
  if (languageCode) form.append("language_code", languageCode);
  // A filename with a plausible extension helps the server sniff the format;
  // the Blob's type carries the real MIME either way.
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("webm") ? "webm" : "audio";
  form.append("file", new Blob([audio], { type: mimeType }), `turn.${ext}`);

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY },
    body: form,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs STT error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { text?: string; language_code?: string };
  return { text: (data.text ?? "").trim(), language_code: data.language_code };
}
