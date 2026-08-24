import { ELEVENLABS_API_KEY, ELEVENLABS_MODEL_ID, ELEVENLABS_VOICE_ID } from "./config.js";

// Returns base64-encoded MP3 audio, or null if ElevenLabs isn't configured
// or the call fails. Callers must treat null as "fall back to the browser's
// local voice" — never as a reason to fail the turn, since reply_text is
// already valid and any tool side-effects already happened.
export async function synthesizeSpeech(text: string, voiceId: string = ELEVENLABS_VOICE_ID): Promise<string | null> {
  if (!ELEVENLABS_API_KEY || !text.trim()) return null;

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID }),
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!res.ok) {
      console.error(`[tts] ElevenLabs error ${res.status}:`, await res.text());
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString("base64");
  } catch (err) {
    console.error("[tts] synthesis failed:", err);
    return null;
  }
}
