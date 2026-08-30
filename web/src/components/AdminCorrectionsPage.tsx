import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ApiError, fetchCorrections, type CorrectionItem, type CorrectionReason } from "../api/client";
import { BackHeader } from "./BackHeader";

interface AdminCorrectionsPageProps {
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

const REASON_LABELS: Record<CorrectionReason, string> = {
  wrong_portion: "Wrong portion size",
  wrong_food: "Wrong food or recipe",
  has_label: "Had the real label",
  skip: "Typo",
};

export function AdminCorrectionsPage({ onBack }: AdminCorrectionsPageProps) {
  const [items, setItems] = useState<CorrectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCorrections()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load corrections."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader
        title="Corrections"
        subtitle={`${items.length} calorie edit${items.length === 1 ? "" : "s"}`}
        onBack={onBack}
      />

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">
          No calorie edits yet — they'll show up here once someone corrects a logged entry.
        </p>
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
              {item.reason && (
                <span className="shrink-0 rounded-full bg-ink3 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink/50">
                  {REASON_LABELS[item.reason]}
                </span>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2 text-sm font-bold text-ink">
              {item.food_key && <span className="text-ink/60">{item.food_key}</span>}
              <span className="text-ink/40 line-through">{item.old_calories} kcal</span>
              <span>→</span>
              <span className="text-coral">{item.new_calories} kcal</span>
            </div>

            {item.evidence_url && (
              <a
                href={item.evidence_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Evidence link
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
