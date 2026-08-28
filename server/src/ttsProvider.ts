import { TTS_PROVIDER } from "./config.js";
import { resolveGeminiVoiceName, resolveVoiceId, type UserProfile } from "./profile.js";
import { synthesizeSpeech as synthesizeElevenLabs } from "./tts.js";
import { synthesizeSpeech as synthesizeGemini } from "./ttsGemini.js";

export interface TtsResult {
  audio_base64: string | null;
  audio_mime: string;
}

// The single point every caller (chat.ts, chatGemini.ts, /greeting) goes
// through instead of importing tts.ts or ttsGemini.ts directly — TTS_PROVIDER
// is independent of LLM_PROVIDER, so either LLM can end up paired with
// either voice. See PROVIDERS.md.
export async function synthesizeSpeech(text: string, profile: UserProfile | null): Promise<TtsResult> {
  if (TTS_PROVIDER === "gemini") {
    return synthesizeGemini(text, resolveGeminiVoiceName(profile));
  }
  const audio_base64 = await synthesizeElevenLabs(text, resolveVoiceId(profile));
  return { audio_base64, audio_mime: "audio/mpeg" };
}
