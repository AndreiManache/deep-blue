import { db } from "./db.js";
import type { UsageKind, UsageProvider } from "./usageLog.js";

// Reference unit prices — checked against each provider's own pricing page
// 2026-08-31 (see PR that added this file for the exact sources). These are
// for an ESTIMATE only; the authoritative numbers always live on each
// provider's own dashboard. Revisit before trusting this for anything more
// than a rough today/this-month sanity check — every one of these has
// already changed at least once this project (see PROVIDERS.md).
//
// LLM: $ per token (not per million — pre-divided for convenience below).
// Anthropic uses Haiku 4.5's rate uniformly even though photo turns run on
// the pricier Sonnet 5 vision model — photo turns are the small minority of
// calls, and tracking per-model within one provider tag wasn't worth the
// added complexity for an estimate. Gemini is 3.5 Flash-Lite, the app's
// actual default model.
const LLM_INPUT_PER_TOKEN: Partial<Record<UsageProvider, number>> = {
  anthropic: 1 / 1_000_000, // Haiku 4.5: $1/MTok input
  gemini: 0.3 / 1_000_000, // 3.5 Flash-Lite: $0.30/MTok input
};
const LLM_OUTPUT_PER_TOKEN: Partial<Record<UsageProvider, number>> = {
  anthropic: 5 / 1_000_000, // Haiku 4.5: $5/MTok output
  gemini: 2.5 / 1_000_000, // 3.5 Flash-Lite: $2.50/MTok output
};

// TTS: $ per character of input text. Murf and ElevenLabs both bill on
// input-text length, which is what's actually logged (see ttsProvider.ts).
// Gemini's TTS instead bills per second of OUTPUT audio (25 audio-tokens/sec
// at $20/M tokens) — converted here via a rough ~15 chars/sec spoken-rate
// assumption, since only chars are logged; this is the least precise of the
// three, but Gemini TTS is also the smallest-volume path (Romanian fallback
// only, and only when Murf is unset), so the imprecision matters least here.
const TTS_PER_CHAR: Partial<Record<UsageProvider, number>> = {
  murf: 10 / 1_000_000, // Falcon 2: $10/M chars ($0.01/1000 chars)
  elevenlabs: 50 / 1_000_000, // Flash/Turbo v2.5: $50/M chars ($0.05/1000 chars)
  gemini: (1 / 15) * (25 / 1_000_000) * 20, // ~$0.033/M chars-equivalent, see comment above
};

// STT: $ per byte of raw audio sent. Neither provider's response reports
// duration, so bytes are what's actually logged (see sttProvider.ts) —
// converted here via a rough ~24kbps (≈3KB/s) compressed-voice bitrate
// assumption for typical mobile MediaRecorder output. Approximate by
// construction; real minutes vary by device/format.
const BYTES_PER_SECOND_ESTIMATE = 3_000;
const STT_PER_BYTE: Partial<Record<UsageProvider, number>> = {
  smallestai: 0.004 / 60 / BYTES_PER_SECOND_ESTIMATE, // Pulse Pro: $0.004/min
  elevenlabs: (0.22 / 60) / BYTES_PER_SECOND_ESTIMATE, // Scribe v2 batch: $0.22/hour
};

// Exported purely so the reference prices above have a regression test
// (see units.test.ts) — not meant to be called from outside this module
// otherwise.
export function unitPrice(provider: UsageProvider, kind: UsageKind): number {
  switch (kind) {
    case "llm_input_tokens":
      return LLM_INPUT_PER_TOKEN[provider] ?? 0;
    case "llm_output_tokens":
      return LLM_OUTPUT_PER_TOKEN[provider] ?? 0;
    case "tts_chars":
      return TTS_PER_CHAR[provider] ?? 0;
    case "stt_bytes":
      return STT_PER_BYTE[provider] ?? 0;
  }
}

export interface UsageBreakdownRow {
  provider: UsageProvider;
  kind: UsageKind;
  amount: number;
  estimated_cost_usd: number;
}

export interface UsageSummary {
  today: UsageBreakdownRow[];
  today_total_usd: number;
  this_month: UsageBreakdownRow[];
  this_month_total_usd: number;
}

const sumStmt = db.prepare(`
  SELECT provider, kind, SUM(amount) AS amount
    FROM usage_log
   WHERE user_id = :user_id AND created_at >= :since
   GROUP BY provider, kind
`);

function summarize(userId: string, since: string): { rows: UsageBreakdownRow[]; total: number } {
  const raw = sumStmt.all({ user_id: userId, since }) as unknown as {
    provider: UsageProvider;
    kind: UsageKind;
    amount: number;
  }[];
  let total = 0;
  const rows = raw.map((r) => {
    const cost = r.amount * unitPrice(r.provider, r.kind);
    total += cost;
    return { ...r, estimated_cost_usd: Math.round(cost * 10000) / 10000 };
  });
  return { rows, total: Math.round(total * 10000) / 10000 };
}

// Both bucketed in the server's local time zone (matches how food entries
// already bucket "today", see entries.ts's date('now','localtime') usage).
export function getUsageSummary(userId: string): UsageSummary {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const today = summarize(userId, todayStart);
  const thisMonth = summarize(userId, monthStart);

  return {
    today: today.rows,
    today_total_usd: today.total,
    this_month: thisMonth.rows,
    this_month_total_usd: thisMonth.total,
  };
}
