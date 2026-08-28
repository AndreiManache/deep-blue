// Shared between chat.ts (Anthropic) and chatGemini.ts (Gemini) so neither
// module has to import the other just to agree on these shapes.

export interface ImageInput {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

export interface ChatTurnResult {
  reply_text: string;
  ended: boolean;
  mutated: boolean;
  audio_base64: string | null;
  audio_mime: string;
  lang: string;
}
