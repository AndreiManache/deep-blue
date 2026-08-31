import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
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

// The card's short description. Prefers the AI-generated summary (2026-08-31
// card redesign); falls back through the typed message, then the transcript,
// then a plain placeholder for reports nobody's run "Generate title" on yet
// — this view was never re-processed when the card design changed, so older
// reports still need something to show.
function descriptionFor(item: MyFeedbackItem): string {
  if (item.summary) return item.summary;
  if (item.message) return item.message;
  if (item.transcript) return item.transcript;
  if (item.has_audio) return "Voice note";
  return "(empty report)";
}

interface FeedbackCardProps {
  item: MyFeedbackItem;
  // A card in the "Fixed issues" section always shows the green "Done" tag
  // regardless of the underlying new/reviewed status — that status was only
  // ever about admin-side triage, and stops being relevant once it's fixed.
  isFixed: boolean;
}

function FeedbackCard({ item, isFixed }: FeedbackCardProps) {
  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.title && (
            <div className="truncate font-display text-sm font-extrabold tracking-tight text-ink">
              {item.title}
            </div>
          )}
          <div className="text-xs font-semibold text-ink/40">{fmtTime(item.created_at)}</div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
            isFixed
              ? "bg-leaf/15 text-leaf"
              : item.status === "new"
                ? "bg-coral/10 text-coral"
                : "bg-sky/10 text-sky",
          )}
        >
          {isFixed ? "Done" : item.status === "new" ? "Sent" : "Reviewed"}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium leading-relaxed text-ink/80">{descriptionFor(item)}</p>
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
  );
}

export function MyFeedbackPage({ onBack }: MyFeedbackPageProps) {
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default (2026-08-31 card redesign) — the active reports
  // above are what a reporter opens this screen to check on; closed-out
  // ones are here to look back at, not to see every time.
  const [showFixed, setShowFixed] = useState(false);

  useEffect(() => {
    fetchMyFeedback()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your feedback."))
      .finally(() => setLoading(false));
  }, []);

  // "completed" (admin-set, distinct from "reviewed" triage bookkeeping) is
  // Andrei's explicit "this is fixed" signal — see AdminFeedbackPage.tsx.
  const active = items.filter((item) => item.status !== "completed");
  const fixed = items.filter((item) => item.status === "completed");

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

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map((item) => (
            <FeedbackCard key={item.id} item={item} isFixed={false} />
          ))}
        </div>
      )}

      {fixed.length > 0 && (
        <div className="border-t border-ink/10 pt-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowFixed((s) => !s)}
            aria-expanded={showFixed}
          >
            <span className="text-sm font-bold text-ink/50">Fixed issues ({fixed.length})</span>
            <ChevronDown className={cn("size-4 text-ink/40 transition-transform", showFixed && "rotate-180")} />
          </button>
          {showFixed && (
            <div className="mt-3 space-y-3">
              {fixed.map((item) => (
                <FeedbackCard key={item.id} item={item} isFixed />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
