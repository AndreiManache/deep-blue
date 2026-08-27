import type Anthropic from "@anthropic-ai/sdk";
import { MAX_HISTORY_TURNS } from "./config.js";

interface SessionEntry {
  history: Anthropic.MessageParam[];
  touchedAt: number;
}

const sessions = new Map<string, SessionEntry>();

// Sessions used to live until end_conversation or a restart — closing the
// tab mid-conversation leaked its history forever. Sweep idle ones instead;
// an hour comfortably outlasts any real pause in a voice conversation.
const SESSION_IDLE_MS = 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, session] of sessions) {
    if (session.touchedAt < cutoff) sessions.delete(id);
  }
}, SWEEP_INTERVAL_MS).unref(); // never keeps the process (or tests) alive

// Always a fresh array, never the stored reference — runTurn mutates this via
// push() while awaiting the model, and if a caller got the same reference the
// Map holds, that mutation would be visible to a second overlapping call for
// the same session before setHistory ever runs, letting two turns interleave
// their pushes into one shared array. That's the exact shape of history
// corruption this app hit in production (a tool_use pushed by one call with
// another call's message landing before its tool_result) — see
// repairDanglingToolUse below for the self-healing half of the fix.
export function getHistory(sessionId: string): Anthropic.MessageParam[] {
  return [...(sessions.get(sessionId)?.history ?? [])];
}

export function setHistory(sessionId: string, history: Anthropic.MessageParam[]): void {
  sessions.set(sessionId, { history, touchedAt: Date.now() });
}

export function clearSession(sessionId: string): void {
  sessions.delete(sessionId);
}

// A message is a "tool-result carrier" if it's a user message whose content
// is entirely tool_result blocks. Such a message must never be separated
// from the assistant tool_use message immediately before it, or the API
// rejects the request with a 400 (orphaned tool_result).
function isToolResultCarrier(message: Anthropic.MessageParam): boolean {
  if (message.role !== "user" || !Array.isArray(message.content)) return false;
  return message.content.length > 0 && message.content.every((block) => block.type === "tool_result");
}

// Keeps the last MAX_HISTORY_TURNS genuine user turns. Counting raw
// messages here (the old behavior) let tool-heavy turns — 4-11 messages
// each — eat the whole budget, shrinking real memory to ~3-5 turns. The
// cut always lands on a genuine user message, never a tool-result carrier,
// so no tool_result is ever orphaned from its tool_use.
// Self-healing for the corruption above, regardless of how it happened: if
// history was somehow left ending on an assistant message that still has
// unresolved tool_use blocks, appending the next turn's plain user message
// right after it is exactly what the API rejects with a 400 ("tool_use ids
// were found without tool_result blocks immediately after") — and since nothing
// here ever succeeds in fixing that turn, the session was stuck failing this
// way forever (until the 60-minute idle sweep). Drop the dangling assistant
// message so the conversation can recover on its very next message instead.
function hasDanglingToolUse(message: Anthropic.MessageParam | undefined): boolean {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) return false;
  return message.content.some((block) => block.type === "tool_use");
}

export function repairDanglingToolUse(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (hasDanglingToolUse(history[history.length - 1])) {
    console.warn("[sessions] dropping a dangling tool_use turn to recover a stuck session");
    return history.slice(0, -1);
  }
  return history;
}

export function truncatePairSafe(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  let turns = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role === "user" && !isToolResultCarrier(message)) {
      turns++;
      // The cap-th turn from the end becomes the new start of history —
      // beginning on a genuine user message, as the API requires.
      if (turns === MAX_HISTORY_TURNS && i > 0) return history.slice(i);
    }
  }
  return history;
}
