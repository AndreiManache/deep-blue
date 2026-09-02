// A short, synthesized "ready to listen" cue for hold-to-talk (2026-09-01
// interaction redesign, ticket #13) — plays the instant the talk button is
// pressed, telling the user it's safe to start speaking. Generated with the
// Web Audio API rather than an audio file so it has zero network dependency
// and zero playback latency (no fetch/decode before it can sound).
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

export function playReadyChime(): void {
  try {
    const audioCtx = getCtx();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") void audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(900, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } catch {
    /* best-effort cue only — never block the actual recording on this */
  }
}
