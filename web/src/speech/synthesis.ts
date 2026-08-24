// Thin wrapper around speechSynthesis with workarounds for well-known Chrome
// bugs that would otherwise strand the app in a "speaking" state forever
// with the mic still closed:
//  - a stuck/paused queue is cleared before every speak() call
//  - the utterance is kept in a module-level variable, because Chrome can
//    garbage-collect it mid-speech and silently drop the `onend` event
//  - a duration-estimate watchdog force-finishes if `onend` never fires
//  - a resume() keepalive works around Chrome pausing utterances after ~15s

export interface SpeakOptions {
  onEnd: () => void;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;
let watchdogTimer: number | null = null;
let keepAliveTimer: number | null = null;

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

export function speak(text: string, { onEnd }: SpeakOptions): void {
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

export function cancelSpeech(): void {
  clearTimers();
  currentUtterance = null;
  window.speechSynthesis?.cancel();
}
