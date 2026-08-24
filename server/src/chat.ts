import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MAX_TOOL_ITERATIONS, MODEL } from "./config.js";
import { getProfile, resolveSpeechLang, resolveVoiceId } from "./profile.js";
import { clearSession, getHistory, setHistory, truncatePairSafe } from "./sessions.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, tools } from "./tools.js";
import { synthesizeSpeech } from "./tts.js";

const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

export interface ChatTurnResult {
  reply_text: string;
  ended: boolean;
  mutated: boolean;
  audio_base64: string | null;
  lang: string;
}

function extractText(content: Anthropic.Message["content"]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join(" ")
    .trim();
}

export async function runTurn(sessionId: string, userId: string, userText: string): Promise<ChatTurnResult> {
  const history = truncatePairSafe(getHistory(sessionId));
  history.push({ role: "user", content: userText });

  let mutated = false;
  let ended = false;
  let response: Anthropic.Message | undefined;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt(userId),
      tools,
      messages: history,
    });

    if (response.stop_reason !== "tool_use") break;

    history.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => {
      const result = executeTool(userId, block.name, block.input as Record<string, unknown>);
      if (result.mutated) mutated = true;
      if (result.ended) ended = true;
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError,
      };
    });

    // All tool_result blocks go back in a single user message — splitting
    // them across messages silently trains the model to stop parallelizing.
    history.push({ role: "user", content: toolResults });
  }

  if (!response) {
    throw new Error("No response received from model");
  }

  // If the loop exited because stop_reason !== 'tool_use', that assistant
  // turn hasn't been pushed yet. If it exited by exhausting the iteration
  // cap mid tool_use, it was already pushed inside the loop above.
  if (response.stop_reason !== "tool_use") {
    history.push({ role: "assistant", content: response.content });
  }

  setHistory(sessionId, history);

  const reply_text = extractText(response.content) || "Okay.";
  // Read fresh (not cached from before the loop) so a language switch made
  // via update_profile during this very turn is reflected immediately — in
  // this reply's voice, and in the STT language the frontend listens with
  // on the user's next turn — not one turn later.
  const profile = getProfile(userId);
  const audio_base64 = await synthesizeSpeech(reply_text, resolveVoiceId(profile));

  return { reply_text, ended, mutated, audio_base64, lang: resolveSpeechLang(profile) };
}

export function endSession(sessionId: string): void {
  clearSession(sessionId);
}
