import { useState } from "react";
import type { UsageBreakdownRow, UsageSummary } from "../api/client";

interface UsageCostCardProps {
  usage: UsageSummary;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  gemini: "Gemini",
  murf: "Murf",
  elevenlabs: "ElevenLabs",
  smallestai: "Smallest AI",
};

const KIND_LABELS: Record<string, string> = {
  llm_input_tokens: "LLM input",
  llm_output_tokens: "LLM output",
  tts_chars: "Voice reply",
  stt_bytes: "Speech-to-text",
};

function fmtUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `<$0.01`;
  return `$${n.toFixed(2)}`;
}

function BreakdownList({ rows }: { rows: UsageBreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs font-medium text-ink/35">Nothing yet.</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div
          key={`${row.provider}-${row.kind}`}
          className="flex items-center justify-between text-xs font-medium text-ink/50"
        >
          <span>
            {KIND_LABELS[row.kind] ?? row.kind} · {PROVIDER_LABELS[row.provider] ?? row.provider}
          </span>
          <span>{fmtUsd(row.estimated_cost_usd)}</span>
        </div>
      ))}
    </div>
  );
}

// A rough, per-user "what am I spending" snapshot (2026-08 backlog item) —
// authoritative numbers always live on each provider's own dashboard, this
// is deliberately just an estimate, worded as such throughout.
export function UsageCostCard({ usage }: UsageCostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasAny = usage.this_month.length > 0;
  if (!hasAny) return null;

  return (
    <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-ink/5">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-xs font-semibold text-ink/40">
          ≈{fmtUsd(usage.today_total_usd)} today · ≈{fmtUsd(usage.this_month_total_usd)} this month
        </span>
        <span className="text-[11px] font-bold text-ink/30">{expanded ? "Hide" : "Details"}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 border-t border-ink/5 pt-3">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink/30">Today</div>
            <BreakdownList rows={usage.today} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-ink/30">This month</div>
            <BreakdownList rows={usage.this_month} />
          </div>
          <p className="text-[10px] font-medium leading-relaxed text-ink/30">
            Estimate only, based on reference prices that change often — check each provider's own
            dashboard for the real number.
          </p>
        </div>
      )}
    </div>
  );
}
