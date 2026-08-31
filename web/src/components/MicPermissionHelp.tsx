import { useT } from "../i18n/useT";

interface MicPermissionHelpProps {
  onRetry: () => void;
}

export function MicPermissionHelp({ onRetry }: MicPermissionHelpProps) {
  const t = useT();
  return (
    <div className="rounded-[2rem] bg-white p-7 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink">
        {t("mic.blockedTitle")}
      </h2>
      <p className="mt-2 text-sm font-medium text-ink/60">{t("mic.blockedBody")}</p>
      <p className="mt-3 text-sm font-medium text-ink/60">{t("mic.dismissedHint")}</p>
      <button
        className="mt-6 w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
        onClick={onRetry}
      >
        {t("mic.tryAgain")}
      </button>
      <p className="mt-5 text-xs font-medium leading-relaxed text-ink/40">{t("mic.alreadyBlockedHint")}</p>
      <p className="mt-3 text-xs font-medium leading-relaxed text-ink/40">{t("mic.installHint")}</p>
    </div>
  );
}
