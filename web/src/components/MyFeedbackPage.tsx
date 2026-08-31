import { useEffect, useState } from "react";
import { ApiError, fetchMyFeedback, type MyFeedbackItem } from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface MyFeedbackPageProps {
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

// What to show as the report's own summary line — the typed message if
// there was one, else the transcript once an admin has transcribed the
// voice note, else a plain fallback (this app never re-transcribes a
// report just because the reporter opened this screen).
function summaryFor(item: MyFeedbackItem): string {
  if (item.message) return item.message;
  if (item.transcript) return item.transcript;
  if (item.has_audio) return "Voice note";
  return "(empty report)";
}

export function MyFeedbackPage({ onBack }: MyFeedbackPageProps) {
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyFeedback()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your feedback."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="My feedback" subtitle="What you've sent, and what happened" onBack={onBack} />

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">
          Nothing sent yet — reports you submit will show up here.
        </p>
      )}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
            <div className="flex items-start justify-between gap-3">
              <div>
                {item.title && (
                  <div className="font-display text-sm font-extrabold tracking-tight text-ink">{item.title}</div>
                )}
                <div className="text-xs font-semibold text-ink/40">{fmtTime(item.created_at)}</div>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
                  item.status === "new" ? "bg-coral/10 text-coral" : "bg-sky/10 text-sky",
                )}
              >
                {item.status === "new" ? "Sent" : "Reviewed"}
              </span>
            </div>
            <p className="mt-2 text-sm font-medium leading-relaxed text-ink/80">{summaryFor(item)}</p>
            {item.image_base64 && (
              <img
                src={`data:${item.image_mime ?? "image/jpeg"};base64,${item.image_base64}`}
                alt="Attached to this report"
                className="mt-3 max-h-48 w-full rounded-xl bg-ink3 object-contain"
              />
            )}
            {item.resolution_note && (
              <div className="mt-3 rounded-xl bg-sky/10 px-3 py-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wide text-sky">From Andrei</div>
                <p className="mt-1 text-sm font-medium leading-relaxed text-ink/80">{item.resolution_note}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
