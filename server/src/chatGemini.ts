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
import { hedgedCall } from "./hedge.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { executeTool, geminiTools } from "./tools.js";
import { synthesizeSpeech } from "./ttsProvider.js";
import { logUsage } from "./usageLog.js";

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

// Per single Gemini call. The turn as a whole is bounded separately by
// TURN_BUDGET_MS below — this is just the ceiling on any one API round trip.
const PER_CALL_TIMEOUT_MS = 20_000;
// Wall-clock budget for the ENTIRE turn (all tool-loop iterations + retries).
// The per-call timeout alone doesn't bound the turn: the loop can run up to
// MAX_TOOL_ITERATIONS times, each with a retry, so without this a slow turn
// stacked to 71s in production (2026-08-28) — long past the point the user
// gave up, and eating into the client's 90s abort with no room for TTS.
// When the budget runs out the turn closes with a spoken fallback instead of
// grinding on. 40s is a ceiling, not a target — normal turns finish in a few
// seconds; this only catches the pathological photo+long-transcript+retry
// pile-ups.
const TURN_BUDGET_MS = 40_000;
// Below this much remaining budget, don't even start another call — there
// isn't time for it to plausibly finish and still leave room for TTS.
const MIN_CALL_HEADROOM_MS = 4_000;
// Tail-latency hedge: if a model call hasn't returned within this long, fire
// a SECOND identical call and take whichever finishes first. Gemini's
// per-call latency is bimodal — a ~1-3s common case with a heavy tail that
// spiked to 18-35s in production (2026-09-03), and those spikes are what made
// the voice UX unusable, not the median. A duplicate request almost never
// draws the same tail, so hedging collapses P90 back toward the median. The
// cost is one extra call ONLY on the slow fraction (a call that beats the
// threshold never triggers a hedge), which is the right trade for a latency-
// critical voice turn. The hedge is on the LLM call ONLY; tools still execute
// once, on the winning response, back in the loop — so nothing runs twice.
const HEDGE_AFTER_MS = 4_000;

// One retry only (2 attempts total). Takes a thunk (rather than params) so
// the create() call's own overload resolution — which distinguishes the
// non-streaming return type — is preserved through the wrapper. `deadline`
// is the turn's wall-clock cutoff: a retry is skipped if there isn't enough
// budget left for it to plausibly finish, so retries can't push the turn
// past TURN_BUDGET_MS.
async function withGeminiRetry<T>(fn: () => Promise<T>, deadline: number): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const timeToRetry = deadline - Date.now() > MIN_CALL_HEADROOM_MS;
      if (attempt === 0 && isRetryableGeminiError(err) && timeToRetry) {
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

function timeoutFallback(profile: UserProfile | null): string {
  return profile?.language === "ro"
    ? "Scuze, a durat prea mult — poți să încerci din nou?"
    : "Sorry, that took too long — can you try again?";
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
  let timedOut = false;
  let inputTokens = 0;
  let outputTokens = 0;

  const deadline = Date.now() + TURN_BUDGET_MS;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_CALL_HEADROOM_MS) {
      timedOut = true;
      break;
    }
    // Each call is capped at the smaller of PER_CALL_TIMEOUT_MS and the
    // budget still left for the whole turn, so a single call can never
    // overshoot the turn deadline.
    const perCallTimeout = Math.min(PER_CALL_TIMEOUT_MS, remaining);
    const systemInstruction = buildSystemPrompt(userId);
    const interaction = await hedgedCall(
      () =>
        withGeminiRetry(
          () =>
            client.interactions.create(
              {
                model: GEMINI_MODEL,
                input: steps,
                system_instruction: systemInstruction,
                tools: geminiTools,
                store: false, // this app manages history itself, same as the Anthropic path
                generation_config: {
                  max_output_tokens: 400,
                  thinking_level: GEMINI_THINKING_LEVEL,
                },
              },
              { timeout: perCallTimeout },
            ),
          deadline,
        ),
      {
        hedgeAfterMs: HEDGE_AFTER_MS,
        // Don't fire a hedge if too little turn budget remains for it to land.
        shouldHedge: () => deadline - Date.now() > MIN_CALL_HEADROOM_MS,
        onHedge: () => console.warn(`[chatGemini] call slow (>${HEDGE_AFTER_MS}ms) — firing a hedge request`),
      },
    );
    inputTokens += interaction.usage?.total_input_tokens ?? 0;
    outputTokens += interaction.usage?.total_output_tokens ?? 0;

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
  if (timedOut) {
    console.warn(
      `[chatGemini] turn exceeded TURN_BUDGET_MS (${TURN_BUDGET_MS}ms) for session ${sessionId} — closing the turn with a fallback reply. Any tool side-effects already ran (mutated=${mutated}).`,
    );
    reply_text = timeoutFallback(profile);
    steps.push({ type: "model_output", content: [{ type: "text", text: reply_text }] });
  } else if (exhausted) {
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
  logUsage(userId, "gemini", "llm_input_tokens", inputTokens);
  logUsage(userId, "gemini", "llm_output_tokens", outputTokens);
  const { audio_base64, audio_mime } = await synthesizeSpeech(reply_text, profile, userId);

  return { reply_text, ended, mutated, audio_base64, audio_mime, lang: resolveSpeechLang(profile) };
}

export function endSession(sessionId: string): void {
  clearGeminiSession(sessionId);
}
