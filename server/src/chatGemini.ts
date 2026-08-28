import { GoogleGenAI, type Interactions } from "@google/genai";

type Step = Interactions.Step;
import { GEMINI_API_KEY, GEMINI_MODEL, GEMINI_THINKING_LEVEL, MAX_TOOL_ITERATIONS } from "./config.js";
import type { ChatTurnResult, ImageInput } from "./llmTypes.js";
import { getProfile, resolveSpeechLang, type UserProfile } from "./profile.js";
import {
  clearGeminiSession,
  getSteps,
  repairDanglingFunctionCall,
  setSteps,
  truncateSteps,
} from "./geminiSessions.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, geminiTools } from "./tools.js";
import { synthesizeSpeech } from "./ttsProvider.js";

// Gemini counterpart to chat.ts's runTurn. Deliberately a separate,
// self-contained implementation rather than one "shared tool loop" forced
// over both providers — Anthropic's content-block message array and
// Gemini's Step[] array are similar in spirit (a flat, resend-in-full
// history) but different enough in shape that a forced shared abstraction
// would be the leakier option. executeTool() and the tool *definitions*
// (tools.ts's toolDefs) are the actual shared source of truth; only the
// wire format and the loop driving it are duplicated.
const client = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Transient Gemini failures worth one automatic retry rather than failing the
// whole turn. `malformed_tool_call` (a 400 where the model emitted invalid
// tool-call JSON) is the big one — a real production hit (2026-08-28, a photo
// turn + long rambling transcript) where Google's own error body literally
// said "Please retry the request" and sent retry-after: 1. It's stochastic,
// so a re-run of the identical request usually succeeds. Also covers the
// "experiencing high demand" 5xx blips. Not retried: anything else (bad key,
// malformed request, etc.) — those won't fix themselves.
const RETRYABLE_GEMINI = /malformed_tool_call|invalid JSON|high demand/i;

function isRetryableGeminiError(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (typeof status === "number" && status >= 500) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return RETRYABLE_GEMINI.test(msg);
}

// One retry only (2 attempts total): each attempt carries its own 20s
// timeout, and the turn still needs headroom for a possible second
// tool-loop iteration plus TTS, all inside the client's 90s abort — so the
// worst case here stays bounded rather than stacking into another hang.
// Takes a thunk (rather than params) so the create() call's own overload
// resolution — which distinguishes the non-streaming return type — is
// preserved through the wrapper.
async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === 0 && isRetryableGeminiError(err)) {
        console.warn(
          `[chatGemini] retryable error, retrying once: ${err instanceof Error ? err.message.slice(0, 140) : String(err)}`,
        );
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable"); // the loop either returns or throws
}

function extractText(steps: Step[]): string {
  return steps
    .filter((s): s is Interactions.ModelOutputStep => s.type === "model_output")
    .flatMap((s) => s.content ?? [])
    .filter((c): c is Interactions.Content & { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join(" ")
    .trim();
}

function exhaustionFallback(profile: UserProfile | null): string {
  return profile?.language === "ro"
    ? "Scuze, s-a complicat prea tare — poți să încerci din nou?"
    : "Sorry, that got complicated — can you try again?";
}

const inFlight = new Set<string>();

export async function runTurn(
  sessionId: string,
  userId: string,
  userText: string,
  image?: ImageInput,
): Promise<ChatTurnResult> {
  if (inFlight.has(sessionId)) {
    throw new Error("A turn is already in progress for this session");
  }
  inFlight.add(sessionId);
  try {
    return await runTurnUnguarded(sessionId, userId, userText, image);
  } finally {
    inFlight.delete(sessionId);
  }
}

async function runTurnUnguarded(
  sessionId: string,
  userId: string,
  userText: string,
  image?: ImageInput,
): Promise<ChatTurnResult> {
  const steps = repairDanglingFunctionCall(truncateSteps(getSteps(sessionId)));

  // Same one-turn-only attachment as chat.ts's Anthropic path: folded into
  // this turn's content, then never referenced again.
  steps.push({
    type: "user_input",
    content: image
      ? [
          { type: "image", data: image.base64, mime_type: image.mediaType },
          { type: "text", text: userText },
        ]
      : [{ type: "text", text: userText }],
  });

  let mutated = false;
  let ended = false;
  let lastStepsOut: Step[] = [];
  let exhausted = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const interaction = await withGeminiRetry(() =>
      client.interactions.create(
        {
          model: GEMINI_MODEL,
          input: steps,
          system_instruction: buildSystemPrompt(userId),
          tools: geminiTools,
          store: false, // this app manages history itself, same as the Anthropic path
          generation_config: {
            max_output_tokens: 400,
            thinking_level: GEMINI_THINKING_LEVEL,
          },
        },
        // 20s per call, not 60s: this call sits inside a loop that can run it
        // more than once per turn (a tool-call round trip is two calls), and
        // the whole /chat request still has to leave room for TTS synthesis
        // afterward, all within the client's 90s abort. A production incident
        // (2026-08-28) showed a single call taking 60.7s end-to-end before the
        // connection was dropped — 60s was already too generous for one call,
        // let alone two. Without any ceiling at all here, an API stall has no
        // bound (unlike ttsGemini.ts, which already sets one), and can leave a
        // turn hanging well past the client abort in a way that reopens the
        // mic unexpectedly once it finally resolves — see the epoch-guard fix
        // in useConversation.ts.
        { timeout: 20_000 },
      ),
    );

    lastStepsOut = interaction.steps ?? [];
    const functionCalls = lastStepsOut.filter(
      (s): s is Step & { type: "function_call" } => s.type === "function_call",
    );

    if (functionCalls.length === 0) break;

    // Record everything the model produced this round (any function_call
    // steps, and possibly a model_output step alongside them) before adding
    // our own function_result steps for each call.
    for (const step of lastStepsOut) steps.push(step);

    for (const call of functionCalls) {
      const result = executeTool(userId, call.name, call.arguments as Record<string, unknown>, userText);
      if (result.mutated) mutated = true;
      if (result.ended) ended = true;
      steps.push({
        type: "function_result",
        call_id: call.id,
        name: call.name,
        result: result.content,
        is_error: result.isError,
      });
    }

    exhausted = i === MAX_TOOL_ITERATIONS - 1;
  }

  const profile = getProfile(userId);

  let reply_text: string;
  if (exhausted) {
    console.warn(
      `[chatGemini] tool loop hit MAX_TOOL_ITERATIONS (${MAX_TOOL_ITERATIONS}) for session ${sessionId} — closing the turn with a fallback reply`,
    );
    reply_text = exhaustionFallback(profile);
    steps.push({ type: "model_output", content: [{ type: "text", text: reply_text }] });
  } else {
    for (const step of lastStepsOut) steps.push(step);
    reply_text = extractText(lastStepsOut) || "Okay.";
  }

  setSteps(sessionId, steps);
  const { audio_base64, audio_mime } = await synthesizeSpeech(reply_text, profile);

  return { reply_text, ended, mutated, audio_base64, audio_mime, lang: resolveSpeechLang(profile) };
}

export function endSession(sessionId: string): void {
  clearGeminiSession(sessionId);
}
