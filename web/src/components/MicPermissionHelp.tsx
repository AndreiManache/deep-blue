interface MicPermissionHelpProps {
  onRetry: () => void;
}

export function MicPermissionHelp({ onRetry }: MicPermissionHelpProps) {
  return (
    <div className="rounded-[2rem] bg-white p-7 shadow-sm ring-1 ring-ink/5">
      <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink">
        Microphone access is blocked
      </h2>
      <p className="mt-2 text-sm font-medium text-ink/60">
        Deep Blue needs your microphone to have a conversation.
      </p>
      <p className="mt-3 text-sm font-medium text-ink/60">
        If you dismissed the browser's permission prompt, tap "Try again" and choose{" "}
        <strong className="text-ink">Allow while visiting the site</strong> — not "Only this time",
        which makes the browser ask again on every visit.
      </p>
      <button
        className="mt-6 w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
        onClick={onRetry}
      >
        Try again
      </button>
      <p className="mt-5 text-xs font-medium leading-relaxed text-ink/40">
        Already blocked it? Open the site settings — the lock or "aA" icon next to the address —
        set <strong className="text-ink/60">Microphone</strong> to{" "}
        <strong className="text-ink/60">Allow</strong>, then reload.
      </p>
      <p className="mt-3 text-xs font-medium leading-relaxed text-ink/40">
        Tip: install Deep Blue from the browser menu (
        <strong className="text-ink/60">Add to Home Screen</strong>). The installed app keeps the
        microphone permission across launches, so you grant it once and never again.
      </p>
    </div>
  );
}
