import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY, MAX_TOOL_ITERATIONS, MODEL } from "./config.js";
import { getProfile, resolveSpeechLang, resolveVoiceId, type UserProfile } from "./profile.js";
import { clearSession, getHistory, setHistory, truncatePairSafe } from "./sessions.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, tools } from "./tools.js";
import { synthesizeSpeech } from "./tts.js";

// 60s timeout (TS SDK default is 10 minutes — a hung request would strand
// the UI in "thinking" for that long) with one retry for transient failures.
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });

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

// Spoken when a turn burns every allowed tool round-trip without the model
// reaching a real answer. Deliberately says something true and actionable —
// the old behavior returned a fabricated "Okay." that claimed a completed
// task, which is worse than admitting the turn didn't finish.
function exhaustionFallback(profile: UserProfile | null): string {
  return profile?.language === "ro"
    ? "Scuze, s-a complicat prea tare — poți să încerci din nou?"
    : "Sorry, that got complicated — can you try again?";
}

export async function runTurn(sessionId: string, userId: string, userText: string): Promise<ChatTurnResult> {
  const history = truncatePairSafe(getHistory(sessionId));
  history.push({ role: "user", content: userText });

  let mutated = false;
  let ended = false;
  let response: Anthropic.Message | undefined;
  let exhausted = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    response = await client.messages.create({
      model: MODEL,
      // Replies are 1-2 spoken sentences; this caps a runaway long answer
      // (which is slow to generate, slow to synthesize, and slow to play) while
      // leaving ample room for a normal reply plus a tool call.
      max_tokens: 400,
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
      const result = executeTool(userId, block.name, block.input as Record<string, unknown>, userText);
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

    // Still asking for tools on the final allowed round-trip: the loop is
    // about to end mid-exchange, with no closing assistant turn coming.
    exhausted = i === MAX_TOOL_ITERATIONS - 1;
  }

  if (!response) {
    throw new Error("No response received from model");
  }

  // Read fresh (not cached from before the loop) so a language switch made
  // via update_profile during this very turn is reflected immediately — in
  // this reply's voice, and in the STT language the frontend listens with
  // on the user's next turn — not one turn later.
  const profile = getProfile(userId);

  let reply_text: string;
  if (exhausted) {
    // The cap ran out while the model was still calling tools, so history
    // currently ends with tool_result blocks and the model's own tool_use
    // turn was never concluded. Saved that way, the next turn resumes from
    // a conversation stuck mid-exchange (and appends a second consecutive
    // user message on top of it). Close it with a synthetic assistant turn
    // carrying the exact words the user is about to hear, so the stored
    // history and what actually happened stay in agreement.
    console.warn(
      `[chat] tool loop hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for session ${sessionId} — closing the turn with a fallback reply`,
    );
    reply_text = exhaustionFallback(profile);
    history.push({ role: "assistant", content: [{ type: "text", text: reply_text }] });
  } else {
    // The loop exited because stop_reason !== 'tool_use', so this assistant
    // turn hasn't been pushed yet.
    history.push({ role: "assistant", content: response.content });
    reply_text = extractText(response.content) || "Okay.";
  }

  setHistory(sessionId, history);
  const audio_base64 = await synthesizeSpeech(reply_text, resolveVoiceId(profile));

  return { reply_text, ended, mutated, audio_base64, lang: resolveSpeechLang(profile) };
}

export function endSession(sessionId: string): void {
  clearSession(sessionId);
}
