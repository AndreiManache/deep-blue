// A short, synthesized "ready to listen" cue for hold-to-talk (2026-09-01
// interaction redesign, ticket #13) — plays the instant the talk button is
// pressed, telling the user it's safe to start speaking. Generated with the
// Web Audio API rather than an audio file so it has zero network dependency
// and zero playback latency (no fetch/decode before it can sound). Shares
// the app-wide AudioContext (see audioContext.ts) so pressing the button
// both plays this cue AND unlocks that context for the AI reply that plays
// on it later.
import { getAudioContext } from "./audioContext";

// Bug (2026-09-04): the chime never played on the very first hold after
// opening the app fresh, only from the second press onward in the same
// session. Root cause: `getAudioContext()` constructs the AudioContext
// lazily, on whichever call happens to be first — on a fresh open, that's
// THIS call, made in the same synchronous tick as TalkButton's own
// resume(). A brand-new context's `currentTime` clock hasn't started
// advancing yet (it stays pinned near 0 until the context actually reaches
// "running"), and resume() is asynchronous — so scheduling the oscillator
// against `currentTime` read in that same tick schedules it against a
// clock that isn't ticking, and the sound is silently lost. By the second
// press the context is already running from the first press's resume
// having long since completed, so `currentTime` is a live clock and it
// plays fine — exactly the reported asymmetry. Fix: actually wait for
// "running" before reading currentTime/scheduling anything on it.
export async function playReadyChime(): Promise<void> {
  try {
    const audioCtx = getAudioContext();
    if (!audioCtx) return;
    if (audioCtx.state !== "running") {
      await audioCtx.resume().catch(() => {});
    }

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
