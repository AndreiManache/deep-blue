import type { CSSProperties } from "react";
import type { Phase } from "../conversation/useConversation";
import { useT, type StringKey } from "../i18n/useT";
import { cn } from "../lib/utils";

interface TalkButtonProps {
  phase: Phase;
  onTap: () => void;
}

const LABEL_KEYS: Partial<Record<Phase, StringKey>> = {
  idle: "talkButton.tapToTalk",
  "awaiting-mic": "talkButton.allowingMic",
};

const BAR_HEIGHTS = ["h-5", "h-9", "h-12", "h-6", "h-8"];

export function TalkButton({ phase, onTap }: TalkButtonProps) {
  const t = useT();
  const listening = phase === "listening";
  const speaking = phase === "speaking";
  const thinking = phase === "thinking";
  const live = listening || speaking;
  const label = LABEL_KEYS[phase] ? t(LABEL_KEYS[phase]!) : phase;

  return (
    <button
      onClick={onTap}
      aria-label={label}
      style={speaking ? ({ "--orb": "var(--color-sky)" } as CSSProperties) : undefined}
      className={cn(
        "relative grid size-56 place-items-center rounded-full transition-all duration-300",
        live && "orb-ring",
        speaking && "bg-sky shadow-[0_20px_60px_-10px_var(--color-sky)]",
        (listening || phase === "idle") &&
          "bg-coral shadow-[0_20px_60px_-10px_var(--color-coral)]",
        thinking && "bg-ink3",
        phase === "awaiting-mic" && "bg-sun",
      )}
    >
      {thinking ? (
        <span className="flex items-center gap-2" aria-hidden="true">
          <span className="thinking-dot size-3 rounded-full bg-ink/50" />
          <span className="thinking-dot size-3 rounded-full bg-ink/50" />
          <span className="thinking-dot size-3 rounded-full bg-ink/50" />
        </span>
      ) : live ? (
        <span className={cn("flex items-center gap-1.5", live && "eq-live")} aria-hidden="true">
          {BAR_HEIGHTS.map((h, i) => (
            <span key={i} className={cn("eq-bar w-1.5 rounded-full bg-white", h)} />
          ))}
        </span>
      ) : (
        <span
          className={cn(
            "font-display text-xl font-bold",
            phase === "awaiting-mic" ? "text-ink" : "text-white",
          )}
        >
          {label}
        </span>
      )}
    </button>
  );
}
