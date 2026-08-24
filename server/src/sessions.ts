import type Anthropic from "@anthropic-ai/sdk";
import { MAX_HISTORY_MESSAGES } from "./config.js";

const sessions = new Map<string, Anthropic.MessageParam[]>();

export function getHistory(sessionId: string): Anthropic.MessageParam[] {
  return sessions.get(sessionId) ?? [];
}

export function setHistory(sessionId: string, history: Anthropic.MessageParam[]): void {
  sessions.set(sessionId, history);
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

// Caps history at MAX_HISTORY_MESSAGES, but only cuts at a safe boundary:
// a user message that is NOT a tool-result carrier (i.e. a genuine new turn).
export function truncatePairSafe(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;

  let cutIndex = history.length - MAX_HISTORY_MESSAGES;
  while (cutIndex < history.length) {
    const candidate = history[cutIndex];
    if (candidate.role === "user" && !isToolResultCarrier(candidate)) break;
    cutIndex++;
  }

  return cutIndex >= history.length ? [] : history.slice(cutIndex);
}
