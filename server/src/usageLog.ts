import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export type UsageProvider = "anthropic" | "gemini" | "murf" | "elevenlabs" | "smallestai";
// LLM input/output tokens are split rather than summed — the two are
// typically priced 4-5x apart, so a single blended "tokens" number can't
// support an accurate cost estimate.
// The token/char/byte kinds are priced (see usageCost.ts). "chat_latency_ms"
// is a non-cost metric riding the same generic (kind, amount) columns: the
// end-to-end server time for one /chat reply, in milliseconds — surfaced as
// the admin panel's average-response-time reality check (see latency.ts). It
// has a unitPrice of 0 so it never touches spend aggregation.
export type UsageKind = "llm_input_tokens" | "llm_output_tokens" | "tts_chars" | "stt_bytes" | "chat_latency_ms";

const insertStmt = db.prepare(`
  INSERT INTO usage_log (id, user_id, provider, kind, amount, created_at)
  VALUES (:id, :user_id, :provider, :kind, :amount, :created_at)
`);

// Called from inside every provider call site (chat.ts, chatGemini.ts,
// ttsProvider.ts, sttProvider.ts) right after a turn/synthesis/transcription
// succeeds. Deliberately swallows every error itself — a bug in cost
// tracking must never be the reason a real user-facing reply fails to come
// back, so this is never awaited for its success and never allowed to throw.
export function logUsage(userId: string, provider: UsageProvider, kind: UsageKind, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  try {
    insertStmt.run({
      id: randomUUID(),
      user_id: userId,
      provider,
      kind,
      amount,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[usageLog] failed to record usage (non-fatal):", err);
  }
}
