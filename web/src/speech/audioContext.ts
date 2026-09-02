// One shared Web Audio context for the whole app. iOS Safari blocks audio
// that isn't started from inside a user gesture — BUT once an AudioContext
// has been resume()'d within a real gesture, everything scheduled on it
// afterwards plays freely, gesture or not (2026-09-02: proven live — the
// ready chime, which runs on this context and is resumed on button-press,
// is the ONE sound that reliably plays on the reporter's iPhone; the AI
// reply, played via an <audio> element from an async chain, was blocked
// with NotAllowedError). So the reply now plays on this same context.
let ctx: AudioContext | null = null;

function ctor(): typeof AudioContext | undefined {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

export function getAudioContext(): AudioContext | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

// Call synchronously inside a user gesture (the talk-button press). Cheap and
// idempotent — safe to call on every press.
export function resumeAudioContext(): void {
  const c = getAudioContext();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}
