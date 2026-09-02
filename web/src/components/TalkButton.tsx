import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Phase } from "../conversation/useConversation";
import { useT, type StringKey } from "../i18n/useT";
import { playReadyChime } from "../speech/chime";
import { unlockAudioPlayback } from "../speech/synthesis";
import { cn } from "../lib/utils";

interface TalkButtonProps {
  phase: Phase;
  onHoldStart: () => void;
  onHoldEnd: () => void;
}

const LABEL_KEYS: Partial<Record<Phase, StringKey>> = {
  idle: "talkButton.holdToTalk",
  "awaiting-mic": "talkButton.allowingMic",
};

const BAR_HEIGHTS = ["h-5", "h-9", "h-12", "h-6", "h-8"];

// Press-and-hold to talk, release to send (2026-09-01 interaction redesign,
// ticket #13) — replaces the old tap-to-start/tap-to-end model. Pointer
// events (not touch/mouse separately) cover mouse, touch, and pen in one
// handler; pointer capture keeps delivering the eventual pointerup/cancel
// to THIS element even if the finger drifts outside the circular hit area
// mid-hold, so a real hold never gets silently dropped.
export function TalkButton({ phase, onHoldStart, onHoldEnd }: TalkButtonProps) {
  const t = useT();
  const listening = phase === "listening";
  const speaking = phase === "speaking";
  const thinking = phase === "thinking";
  const live = listening || speaking;
  const label = LABEL_KEYS[phase] ? t(LABEL_KEYS[phase]!) : phase;

  function handlePointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    // Both of these MUST run synchronously, right here, inside the real
    // gesture — not later inside onHoldStart's async chain. iOS only grants
    // audio playback that ignores the ringer's silent switch to a <audio>
    // element that's been play()'d within an actual user gesture; by the
    // time the AI's reply is ready to play, several awaits (mic, STT, chat,
    // TTS) have already happened and the gesture has long since expired.
    // Found live 2026-09-02: "Speaking…" showed, phone was on silent, no
    // sound at all — the reply was never unlocked.
    playReadyChime();
    unlockAudioPlayback();
    // Best-effort only — if the browser won't capture this pointer for any
    // reason, the hold must still start. Letting this throw would silently
    // swallow onHoldStart() entirely, leaving the button looking dead.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fall through — pointerup/cancel may not re-target this element if
         the finger drifts off it, but the hold itself still works */
    }
    onHoldStart();
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    onHoldEnd();
  }

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={label}
      style={speaking ? ({ "--orb": "var(--color-sky)" } as CSSProperties) : undefined}
      className={cn(
        "relative grid size-56 touch-none select-none place-items-center rounded-full transition-all duration-300",
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
