import { SMALLESTAI_API_KEY } from "./config.js";
import { SttNotConfiguredError, transcribeAudio as transcribeElevenLabs, type TranscriptionResult } from "./stt.js";
import { transcribeAudio as transcribeSmallest } from "./sttSmallest.js";
import { logUsage } from "./usageLog.js";

export { SttNotConfiguredError };
export type { TranscriptionResult };

// Smallest AI's Pulse Pro is the default STT (faster, comparably accurate to
// ElevenLabs Scribe) for everyone except a profile with a confirmed
// language:"ro" preference — Pulse Pro is English-only, so Romanian always
// goes to Scribe regardless. Deliberate 2026-08-28 tradeoff: this means a
// brand-new user's first-ever Romanian utterance, before they've set
// language to "ro" in Profile, is likely to transcribe poorly — the
// previous design routed the language-unknown case to Scribe specifically
// to protect that auto-detect-on-first-utterance flow (see
// systemPrompt.ts's languageRule), which this change knowingly gives up in
// exchange for Smallest AI being the default rather than an opt-in. Any
// Smallest AI failure falls back to Scribe on the same audio bytes rather
// than surfacing an error to the user.
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  userId: string,
  languageCode?: string,
): Promise<TranscriptionResult> {
  if (languageCode !== "ro" && SMALLESTAI_API_KEY) {
    try {
      const result = await transcribeSmallest(audio);
      console.log("[sttProvider] transcribed via Smallest AI Pulse Pro");
      logUsage(userId, "smallestai", "stt_bytes", audio.byteLength);
      return { text: result.text, language_code: "en" };
    } catch (err) {
      console.error("[sttProvider] Smallest AI failed, falling back to ElevenLabs:", err);
    }
  }
  const result = await transcribeElevenLabs(audio, mimeType, languageCode);
  logUsage(userId, "elevenlabs", "stt_bytes", audio.byteLength);
  return result;
}
