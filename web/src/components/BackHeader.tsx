import { ArrowLeft } from "lucide-react";
import { useT } from "../i18n/useT";
import { useSwipeBack } from "../lib/useSwipeBack";

interface BackHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
}

// Every sub-page renders exactly one of these for its lifetime, with the
// same onBack it wires to the arrow button — so hooking the edge-swipe
// gesture in here covers every page (2026-08-30 backlog item, Andrei:
// "wants to swipe back between pages") without touching each page file.
export function BackHeader({ title, subtitle, onBack }: BackHeaderProps) {
  useSwipeBack(onBack);
  const t = useT();
  return (
    <div className="flex items-center gap-4">
      <button
        className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
        onClick={onBack}
        aria-label={t("backHeader.back")}
      >
        <ArrowLeft className="size-5 text-ink/70" />
      </button>
      <div>
        <h1 className="font-display text-3xl font-extrabold leading-none tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm font-medium text-ink/50">{subtitle}</p>
      </div>
    </div>
  );
}
