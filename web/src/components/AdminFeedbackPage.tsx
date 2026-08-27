import { useEffect, useState } from "react";
import { ApiError, fetchAdminFeedback, setFeedbackStatus, type FeedbackItem } from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface AdminFeedbackPageProps {
  onBack: () => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function AdminFeedbackPage({ onBack }: AdminFeedbackPageProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminFeedback()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load feedback."))
      .finally(() => setLoading(false));
  }, []);

  async function toggleStatus(item: FeedbackItem) {
    const next = item.status === "new" ? "reviewed" : "new";
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
    try {
      await setFeedbackStatus(item.id, next);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    }
  }

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="Feedback inbox" subtitle={`${items.length} report${items.length === 1 ? "" : "s"}`} onBack={onBack} />

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">No feedback yet.</p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-display text-sm font-extrabold tracking-tight text-ink">
                  {item.username}
                </div>
                <div className="text-xs font-semibold text-ink/40">{fmtTime(item.created_at)}</div>
              </div>
              <button
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors",
                  item.status === "new"
                    ? "bg-coral/10 text-coral hover:bg-coral/20"
                    : "bg-ink3 text-ink/40 hover:bg-ink/10",
                )}
                onClick={() => toggleStatus(item)}
              >
                {item.status === "new" ? "New" : "Reviewed"}
              </button>
            </div>

            {item.message && (
              <p className="mt-3 text-sm font-medium leading-relaxed text-ink/80">{item.message}</p>
            )}

            {item.audio_base64 && (
              <audio
                className="mt-3 h-8 w-full"
                controls
                src={`data:${item.audio_mime ?? "audio/mp4"};base64,${item.audio_base64}`}
              />
            )}

            {item.log_snapshot && (
              <div className="mt-3">
                <button
                  className="text-xs font-bold text-ink/40 underline underline-offset-2 hover:text-ink/70"
                  onClick={() => setExpandedLog(expandedLog === item.id ? null : item.id)}
                >
                  {expandedLog === item.id ? "Hide diagnostics log" : "Show diagnostics log"}
                </button>
                {expandedLog === item.id && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-ink p-3 font-mono text-[11px] leading-relaxed text-white/70">
                    {formatLog(item.log_snapshot)}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatLog(raw: string): string {
  try {
    const events = JSON.parse(raw) as { t: number; label: string; detail?: string }[];
    return events
      .map((e) => `${new Date(e.t).toLocaleTimeString(undefined, { hour12: false })}  ${e.label}${e.detail ? `: ${e.detail}` : ""}`)
      .join("\n");
  } catch {
    return raw;
  }
}
