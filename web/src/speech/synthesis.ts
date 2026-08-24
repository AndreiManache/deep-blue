// Two speech-output paths sharing one { onEnd } contract, so callers don't
// care which is actually playing:
//  - Pre-synthesized audio (ElevenLabs, played via <audio>) for real AI
//    replies — better voice quality, costs a little.
//  - The browser's speechSynthesis for canned local phrases (greeting,
//    "didn't catch that", network errors) — zero cost, zero network
//    dependency, so those keep working even if ElevenLabs is unconfigured
//    or down. Also the automatic fallback if audio playback itself fails.
//
// speechSynthesis workarounds (unchanged from the original implementation):
//  - a stuck/paused queue is cleared before every speak() call
//  - the utterance is kept in a module-level variable, because Chrome can
//    garbage-collect it mid-speech and silently drop the `onend` event
//  - a duration-estimate watchdog force-finishes if `onend` never fires
//  - a resume() keepalive works around Chrome pausing utterances after ~15s
// The <audio> path gets its own simpler watchdog — standard HTMLMediaElement
// events are far more reliable than speechSynthesis's, so it needs less.

export interface SpeakOptions {
  onEnd: () => void;
  audioBase64?: string | null;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;
let watchdogTimer: number | null = null;
let keepAliveTimer: number | null = null;

let audioEl: HTMLAudioElement | null = null;
let audioWatchdogTimer: number | null = null;

function clearTimers(): void {
  if (watchdogTimer !== null) {
    window.clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
  if (keepAliveTimer !== null) {
    window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function clearAudioWatchdog(): void {
  if (audioWatchdogTimer !== null) {
    window.clearTimeout(audioWatchdogTimer);
    audioWatchdogTimer = null;
  }
}

function speakLocal(text: string, onEnd: () => void): void {
  if (!window.speechSynthesis) {
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();
  clearTimers();

  const utterance = new SpeechSynthesisUtterance(text);
  currentUtterance = utterance;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimers();
    currentUtterance = null;
    onEnd();
  };

  utterance.onend = finish;
  utterance.onerror = finish;

  const estimatedMs = Math.max(3000, (text.length / 14) * 1000 + 2000);
  watchdogTimer = window.setTimeout(finish, estimatedMs);

  keepAliveTimer = window.setInterval(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);

  window.speechSynthesis.speak(utterance);
}

function getAudioElement(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.setAttribute("playsinline", "true"); // iOS: play inline, not fullscreen
  }
  return audioEl;
}

function playRemoteAudio(base64: string, text: string, onEnd: () => void): void {
  const el = getAudioElement();
  clearAudioWatchdog();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    onEnd();
  };
  const fallbackToLocal = () => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    // Playback failed (autoplay block, decode error, network hiccup, etc) —
    // never leave the conversation stuck; degrade to the local voice.
    speakLocal(text, onEnd);
  };

  el.onended = finish;
  el.onerror = fallbackToLocal;
  el.src = `data:audio/mpeg;base64,${base64}`;

  // ~14 chars/sec (matches the local watchdog) plus network/decode slack,
  // in case `ended`/`error` never fire.
  const estimatedMs = Math.max(4000, (text.length / 14) * 1000 + 3000);
  audioWatchdogTimer = window.setTimeout(finish, estimatedMs);

  el.play()?.catch(fallbackToLocal);
}

export function speak(text: string, { onEnd, audioBase64 }: SpeakOptions): void {
  if (audioBase64) {
    playRemoteAudio(audioBase64, text, onEnd);
    return;
  }
  speakLocal(text, onEnd);
}

export function cancelSpeech(): void {
  clearTimers();
  currentUtterance = null;
  window.speechSynthesis?.cancel();

  clearAudioWatchdog();
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
}
