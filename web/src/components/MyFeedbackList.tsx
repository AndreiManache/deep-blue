import { useEffect, useState } from "react";
import { ChevronDown, PartyPopper } from "lucide-react";
import { ApiError, fetchMyFeedback, type MyFeedbackItem } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useT } from "../i18n/useT";
import { cn } from "../lib/utils";

function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
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
function descriptionFor(item: MyFeedbackItem, t: ReturnType<typeof useT>): string {
  if (item.summary) return item.summary;
  if (item.message) return item.message;
  if (item.transcript) return item.transcript;
  if (item.has_audio) return t("myFeedback.voiceNote");
  return t("myFeedback.emptyReport");
}

interface FeedbackCardProps {
  item: MyFeedbackItem;
  // A card in the "Fixed issues" section always shows the green "Done" tag
  // regardless of the underlying new/reviewed status — that status was only
  // ever about admin-side triage, and stops being relevant once it's fixed.
  isFixed: boolean;
}

function FeedbackCard({ item, isFixed }: FeedbackCardProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === "ro" ? "ro-RO" : "en-US";
  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {item.title && (
            <div className="truncate font-display text-sm font-extrabold tracking-tight text-ink">
              {item.title}
            </div>
          )}
          <div className="text-xs font-semibold text-ink/40">{fmtTime(item.created_at, locale)}</div>
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
          {isFixed ? t("myFeedback.statusDone") : item.status === "new" ? t("myFeedback.statusSent") : t("myFeedback.statusReviewed")}
        </span>
      </div>
      <p className="mt-2 text-sm font-medium leading-relaxed text-ink/80">{descriptionFor(item, t)}</p>
      {item.image_base64 && (
        <img
          src={`data:${item.image_mime ?? "image/jpeg"};base64,${item.image_base64}`}
          alt={t("myFeedback.attachedAlt")}
          className="mt-3 max-h-48 w-full rounded-xl bg-ink3 object-contain"
        />
      )}
      {item.resolution_note && (
        <div className="mt-3 rounded-xl bg-sky/10 px-3 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-sky">{t("myFeedback.fromAndrei")}</div>
          <p className="mt-1 text-sm font-medium leading-relaxed text-ink/80">{item.resolution_note}</p>
        </div>
      )}
    </div>
  );
}

// The reporter's own list of what they've sent and what happened to it —
// formerly its own page ("My feedback"), now the second tab of the merged
// Feedback page (2026-08-31, "we don't want two separate items in the main
// menu about feedback"). No BackHeader/outer page wrapper of its own since
// it's always embedded inside another page's layout.
export function MyFeedbackList() {
  const t = useT();
  const [items, setItems] = useState<MyFeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default — the active reports above are what a reporter
  // checks on; closed-out ones are here to look back at, not to see every time.
  const [showFixed, setShowFixed] = useState(false);

  useEffect(() => {
    fetchMyFeedback()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : t("myFeedback.loadError")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "completed" (admin-set, distinct from "reviewed" triage bookkeeping) is
  // Andrei's explicit "this is fixed" signal — see AdminFeedbackPage.tsx.
  const active = items.filter((item) => item.status !== "completed");
  const fixed = items.filter((item) => item.status === "completed");

  return (
    <div className="space-y-6">
      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">{t("myFeedback.loading")}</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">{t("myFeedback.nothingSent")}</p>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map((item) => (
            <FeedbackCard key={item.id} item={item} isFixed={false} />
          ))}
        </div>
      )}

      {!loading && !error && items.length > 0 && active.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-[2rem] bg-leaf/10 px-6 py-10 text-center">
          <PartyPopper className="size-7 text-leaf" />
          <p className="font-display text-base font-extrabold text-ink">{t("myFeedback.allCaughtUpTitle")}</p>
          <p className="text-sm font-medium leading-relaxed text-ink/60">{t("myFeedback.allCaughtUpBody")}</p>
        </div>
      )}

      {fixed.length > 0 && (
        <div className="border-t border-ink/10 pt-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowFixed((s) => !s)}
            aria-expanded={showFixed}
          >
            <span className="text-sm font-bold text-ink/50">
              {t("myFeedback.fixedIssues", { count: fixed.length })}
            </span>
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
