import { SMALLESTAI_API_KEY } from "./config.js";
import { SttNotConfiguredError, transcribeAudio as transcribeElevenLabs, type TranscriptionResult } from "./stt.js";
import { transcribeAudio as transcribeSmallest } from "./sttSmallest.js";

export { SttNotConfiguredError };
export type { TranscriptionResult };

// Smallest AI's Pulse Pro is faster and comparably accurate to ElevenLabs
// Scribe, but English-only — so it's only tried when the caller already has
// a confirmed language:"en" profile preference (never for the
// language-unknown case, whose ElevenLabs auto-detect is what makes
// first-contact Romanian detection work at all — see systemPrompt.ts). Any
// failure falls back to Scribe on the same audio bytes rather than
// surfacing an error to the user.
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  languageCode?: string,
): Promise<TranscriptionResult> {
  if (languageCode === "en" && SMALLESTAI_API_KEY) {
    try {
      const result = await transcribeSmallest(audio);
      console.log("[sttProvider] transcribed via Smallest AI Pulse Pro");
      return { text: result.text, language_code: "en" };
    } catch (err) {
      console.error("[sttProvider] Smallest AI failed, falling back to ElevenLabs:", err);
    }
  }
  return transcribeElevenLabs(audio, mimeType, languageCode);
}
