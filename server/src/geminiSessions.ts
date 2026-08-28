import type { Interactions } from "@google/genai";
import { MAX_HISTORY_TURNS } from "./config.js";

type Step = Interactions.Step;

// Mirrors sessions.ts's shape, but for Gemini's Interactions API: conversation
// state is a flat Step[] array (user_input / model_output / function_call /
// function_result steps) resent in full each call — the app manages history
// itself (store: false) rather than relying on Gemini's server-side
// previous_interaction_id, so a session looks the same to the rest of this
// codebase regardless of which LLM_PROVIDER is active.

interface SessionEntry {
  steps: Step[];
  touchedAt: number;
}

const sessions = new Map<string, SessionEntry>();

const SESSION_IDLE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) {
    if (session.touchedAt < cutoff) sessions.delete(id);
  }
}, SWEEP_INTERVAL_MS).unref();

// Always a fresh copy — same reasoning as sessions.ts's getHistory: never
// hand out the stored reference, so an in-progress turn's mutations can't
// leak into a second concurrent read before setSteps replaces it.
export function getSteps(sessionId: string): Step[] {
  return [...(sessions.get(sessionId)?.steps ?? [])];
}

export function setSteps(sessionId: string, steps: Step[]): void {
  sessions.set(sessionId, { steps, touchedAt: Date.now() });
}

export function clearGeminiSession(sessionId: string): void {
  sessions.delete(sessionId);
}

function isUserInputStart(step: Step): boolean {
  return step.type === "user_input";
}

// Keeps the last MAX_HISTORY_TURNS user turns, always cutting at a
// user_input step so a resumed conversation never starts mid function-call
// exchange. Simpler than sessions.ts's truncatePairSafe — Gemini's step
// types are each single-purpose (a function_result step can't also be a
// user turn), so there's no "is this whole message actually a tool result
// carrier" ambiguity to resolve.
export function truncateSteps(steps: Step[]): Step[] {
  let turns = 0;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (isUserInputStart(steps[i])) {
      turns++;
      if (turns === MAX_HISTORY_TURNS && i > 0) return steps.slice(i);
    }
  }
  return steps;
}

// Self-healing counterpart to sessions.ts's repairDanglingToolUse: if the
// stored steps end on a function_call with no matching function_result
// (the process died mid-loop, or some other rare edge case), drop it so the
// next turn starts clean instead of resending a call the model already made
// with no result ever supplied for it.
export function repairDanglingFunctionCall(steps: Step[]): Step[] {
  const last = steps[steps.length - 1];
  if (last && last.type === "function_call") {
    console.warn("[geminiSessions] dropping a dangling function_call step to recover a stuck session");
    return steps.slice(0, -1);
  }
  return steps;
}
