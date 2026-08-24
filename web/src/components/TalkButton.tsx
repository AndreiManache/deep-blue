import type { Phase } from "../conversation/useConversation";

interface TalkButtonProps {
  phase: Phase;
  onTap: () => void;
}

const LABELS: Record<Phase, string> = {
  idle: "Tap to talk",
  "awaiting-mic": "Allow mic…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  unsupported: "",
};

export function TalkButton({ phase, onTap }: TalkButtonProps) {
  return (
    <button
      className={`talk-button phase-${phase}`}
      onClick={onTap}
      aria-label={LABELS[phase] || "Talk"}
    >
      <span className="talk-button-core">
        {phase === "thinking" ? (
          <span className="thinking-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span>{LABELS[phase]}</span>
        )}
      </span>
    </button>
  );
}
