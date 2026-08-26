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
  /** BCP-47 tag (e.g. "ro-RO") — without it the fallback voice reads Romanian text with English phonemes. */
  lang?: string;
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

function speakLocal(text: string, onEnd: () => void, lang?: string): void {
  if (!window.speechSynthesis) {
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();
  clearTimers();

  const utterance = new SpeechSynthesisUtterance(text);
  if (lang) utterance.lang = lang;
  currentUtterance = utterance;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimers();
    currentUtterance = null;
    // If the watchdog beat the utterance's own end event, the voice is
    // still speaking — silence it before the caller reopens the mic, or
    // the mic hears the tail of our own speech.
    window.speechSynthesis.cancel();
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

function playRemoteAudio(base64: string, text: string, onEnd: () => void, lang?: string): void {
  const el = getAudioElement();
  clearAudioWatchdog();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    // Fully release the audio element before the caller reopens the mic. On
    // iOS, leaving playback attached keeps the audio session in playback mode,
    // which starves the SpeechRecognition that opens next (it starts but
    // receives no microphone audio — the "it didn't hear me" case). pause +
    // drop the src + load() tears the element down so iOS can flip the session
    // back to record. (Also stops the watchdog case where audio is still
    // playing, so the mic never hears the tail of the AI's own reply.)
    el.pause();
    el.removeAttribute("src");
    el.load();
    onEnd();
  };
  const fallbackToLocal = () => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    // Playback failed (autoplay block, decode error, network hiccup, etc) —
    // never leave the conversation stuck; degrade to the local voice.
    speakLocal(text, onEnd, lang);
  };

  el.onended = finish;
  el.onerror = fallbackToLocal;
  // Once metadata arrives the element knows the real duration — re-arm the
  // watchdog from that instead of guessing. A chars/sec guess undershoots
  // slower speech (Romanian especially), and a watchdog that fires
  // mid-playback used to open the mic into the AI's own voice.
  el.onloadedmetadata = () => {
    if (done || !Number.isFinite(el.duration)) return;
    clearAudioWatchdog();
    audioWatchdogTimer = window.setTimeout(finish, el.duration * 1000 + 2000);
  };
  el.src = `data:audio/mpeg;base64,${base64}`;

  // Deliberately generous initial estimate — only a backstop for the case
  // where metadata never loads; the real deadline is set above.
  const estimatedMs = Math.max(8000, (text.length / 8) * 1000 + 4000);
  audioWatchdogTimer = window.setTimeout(finish, estimatedMs);

  el.play()?.catch(fallbackToLocal);
}

export function speak(text: string, { onEnd, audioBase64, lang }: SpeakOptions): void {
  if (audioBase64) {
    playRemoteAudio(audioBase64, text, onEnd, lang);
    return;
  }
  speakLocal(text, onEnd, lang);
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
