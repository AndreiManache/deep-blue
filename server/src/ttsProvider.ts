import { MURF_API_KEY, MURF_VOICE_ID, TTS_PROVIDER } from "./config.js";
import { resolveGeminiVoiceName, resolveVoiceId, type UserProfile } from "./profile.js";
import { synthesizeSpeech as synthesizeElevenLabs } from "./tts.js";
import { synthesizeSpeech as synthesizeGemini } from "./ttsGemini.js";
import { synthesizeSpeech as synthesizeMurf } from "./ttsMurf.js";

export interface TtsResult {
  audio_base64: string | null;
  audio_mime: string;
}

async function synthesizeFromProviderSwitch(text: string, profile: UserProfile | null): Promise<TtsResult> {
  if (TTS_PROVIDER === "gemini") {
    return synthesizeGemini(text, resolveGeminiVoiceName(profile));
  }
  const audio_base64 = await synthesizeElevenLabs(text, resolveVoiceId(profile));
  return { audio_base64, audio_mime: "audio/mpeg" };
}

// The single point every caller (chat.ts, chatGemini.ts, /greeting) goes
// through instead of importing tts.ts/ttsGemini.ts/ttsMurf.ts directly.
//
// Default TTS provider (2026-08-28): Murf's Falcon 2, for everyone except a
// confirmed language:"ro" profile — which uses whatever TTS_PROVIDER
// resolves to instead (Gemini, per how it's set today). Deliberate choice,
// not a technical limitation: Murf's cross-lingual voices do produce valid
// Romanian audio (confirmed against the real API), but an English-native
// voice reading Romanian phonetically is an unverified quality bet next to
// Gemini's dedicated Romanian voice support, so Romanian keeps the
// established path. Any Murf failure falls back to the TTS_PROVIDER switch
// too, same graceful-degradation pattern as sttProvider.ts.
export async function synthesizeSpeech(text: string, profile: UserProfile | null): Promise<TtsResult> {
  if (MURF_API_KEY && profile?.language !== "ro") {
    try {
      const result = await synthesizeMurf(text, MURF_VOICE_ID);
      if (result.audio_base64) {
        console.log("[ttsProvider] synthesized via Murf Falcon 2");
        return result;
      }
    } catch (err) {
      console.error("[ttsProvider] Murf failed, falling back:", err);
    }
  }
  return synthesizeFromProviderSwitch(text, profile);
}
