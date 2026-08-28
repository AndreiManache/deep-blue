import { GoogleGenAI } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_TTS_MODEL } from "./config.js";

const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

export interface GeminiTtsResult {
  audio_base64: string | null;
  audio_mime: string;
}

// Confirmed against the live API: this model rejects response_format
// entirely (400 on both "audio/mp3" and "audio/wav" — "not supported for
// models/gemini-3.1-flash-tts-preview") and just always returns its native
// format regardless: raw headerless 16-bit PCM, reported back as
// "audio/l16; rate=24000; channels=1". That's not independently playable via
// an <audio> element, so it gets wrapped in a minimal WAV container here —
// parsing rate/channels out of the reported mime rather than hardcoding
// them, in case that ever changes.
function parsePcmMime(mime: string): { sampleRate: number; channels: number } {
  const rate = /rate=(\d+)/.exec(mime);
  const channels = /channels=(\d+)/.exec(mime);
  return {
    sampleRate: rate ? Number(rate[1]) : 24000,
    channels: channels ? Number(channels[1]) : 1,
  };
}

function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample = 16): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Same graceful-degradation contract as tts.ts's synthesizeSpeech: null
// audio_base64 means "fall back to the browser's local voice", never a
// reason to fail the turn — reply_text is already valid and any tool
// side-effects already happened.
export async function synthesizeSpeech(text: string, voiceName: string): Promise<GeminiTtsResult> {
  const fallback: GeminiTtsResult = { audio_base64: null, audio_mime: "audio/wav" };
  if (!GEMINI_API_KEY || !text.trim()) return fallback;

  try {
    const interaction = await client.interactions.create(
      {
        model: GEMINI_TTS_MODEL,
        input: text,
        generation_config: {
          speech_config: [{ voice: voiceName }],
        },
        store: false,
      },
      { timeout: 15000 },
    );

    const audio = interaction.output_audio;
    if (!audio?.data) {
      console.error("[ttsGemini] no output_audio in response");
      return fallback;
    }
    const { sampleRate, channels } = parsePcmMime(audio.mime_type ?? "");
    const wav = pcmToWav(Buffer.from(audio.data, "base64"), sampleRate, channels);
    return { audio_base64: wav.toString("base64"), audio_mime: "audio/wav" };
  } catch (err) {
    console.error("[ttsGemini] synthesis failed:", err);
    return fallback;
  }
}
