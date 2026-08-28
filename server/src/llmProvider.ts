import { LLM_PROVIDER } from "./config.js";
import { endSession as endAnthropicSession, runTurn as runAnthropicTurn } from "./chat.js";
import { endSession as endGeminiSession, runTurn as runGeminiTurn } from "./chatGemini.js";
import type { ChatTurnResult, ImageInput } from "./llmTypes.js";

// The single point index.ts goes through for /chat instead of importing
// chat.ts or chatGemini.ts directly — flip LLM_PROVIDER and every /chat
// request routes to the other implementation with no other code change.
// See PROVIDERS.md.
export function runTurn(
  sessionId: string,
  userId: string,
  userText: string,
  image?: ImageInput,
): Promise<ChatTurnResult> {
  return LLM_PROVIDER === "gemini"
    ? runGeminiTurn(sessionId, userId, userText, image)
    : runAnthropicTurn(sessionId, userId, userText, image);
}

export function endSession(sessionId: string): void {
  if (LLM_PROVIDER === "gemini") {
    endGeminiSession(sessionId);
  } else {
    endAnthropicSession(sessionId);
  }
}
