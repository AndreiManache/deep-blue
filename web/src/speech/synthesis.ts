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
  /** Real MIME of audioBase64 — providers differ (ElevenLabs: MP3, Gemini TTS: configurable). Defaults to MP3 for older callers. */
  audioMime?: string;
  /** BCP-47 tag (e.g. "ro-RO") — without it the fallback voice reads Romanian text with English phonemes. */
  lang?: string;
  /**
   * Optional diagnostic hook — fired at the points that actually decide
   * whether sound comes out (2026-09-02: a live "I hear nothing" report
   * that "Speaking…" showed for gave no way to tell, after the fact,
   * whether the real AI voice played or a silent fallback ran instead).
   * Wire this to the same log a feedback report can attach.
   */
  onDiag?: (label: string, detail?: string) => void;
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

function speakLocal(text: string, onEnd: () => void, lang?: string, onDiag?: (label: string, detail?: string) => void): void {
  if (!window.speechSynthesis) {
    onDiag?.("local voice unavailable — speechSynthesis not supported");
    onEnd();
    return;
  }

  window.speechSynthesis.cancel();
  clearTimers();

  const utterance = new SpeechSynthesisUtterance(text);
  if (lang) utterance.lang = lang;
  currentUtterance = utterance;

  let done = false;
  let watchdogFired = false;
  const finish = (via: "onend" | "onerror" | "watchdog") => {
    if (done) return;
    done = true;
    clearTimers();
    currentUtterance = null;
    // If the watchdog beat the utterance's own end event, the voice is
    // still speaking — silence it before the caller reopens the mic, or
    // the mic hears the tail of our own speech.
    window.speechSynthesis.cancel();
    onDiag?.(`local voice finished (${via})`, watchdogFired ? "watchdog already fired first" : undefined);
    onEnd();
  };

  utterance.onend = () => finish("onend");
  utterance.onerror = () => finish("onerror");

  const voiceCount = window.speechSynthesis.getVoices().length;
  onDiag?.("speaking via local voice", `${voiceCount} voice(s) available`);

  const estimatedMs = Math.max(3000, (text.length / 14) * 1000 + 2000);
  watchdogTimer = window.setTimeout(() => {
    watchdogFired = true;
    finish("watchdog");
  }, estimatedMs);

  keepAliveTimer = window.setInterval(() => {
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000);

  window.speechSynthesis.speak(utterance);
  // Reported right after speak() is called — if this is false immediately
  // and stays false, the utterance never actually started (a real, silent
  // failure mode on some mobile browsers when no voice is loaded yet).
  setTimeout(() => onDiag?.("speechSynthesis.speaking", String(window.speechSynthesis.speaking)), 50);
}

function getAudioElement(): HTMLAudioElement {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.setAttribute("playsinline", "true"); // iOS: play inline, not fullscreen
  }
  return audioEl;
}

function playRemoteAudio(
  base64: string,
  mime: string,
  text: string,
  onEnd: () => void,
  lang?: string,
  onDiag?: (label: string, detail?: string) => void,
): void {
  const el = getAudioElement();
  clearAudioWatchdog();

  let done = false;
  let viaWatchdog = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    onDiag?.("remote audio finished", viaWatchdog ? "watchdog, not a real onended" : "onended");
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
  const fallbackToLocal = (reason: string) => {
    if (done) return;
    done = true;
    clearAudioWatchdog();
    // Playback failed (autoplay block, decode error, network hiccup, etc) —
    // never leave the conversation stuck; degrade to the local voice.
    onDiag?.("remote audio failed, falling back to local voice", reason);
    speakLocal(text, onEnd, lang, onDiag);
  };

  el.onended = finish;
  el.onerror = () => fallbackToLocal(`element error, code ${el.error?.code ?? "?"}`);
  // Once metadata arrives the element knows the real duration — re-arm the
  // watchdog from that instead of guessing. A chars/sec guess undershoots
  // slower speech (Romanian especially), and a watchdog that fires
  // mid-playback used to open the mic into the AI's own voice.
  el.onloadedmetadata = () => {
    if (done || !Number.isFinite(el.duration)) return;
    clearAudioWatchdog();
    audioWatchdogTimer = window.setTimeout(() => {
      viaWatchdog = true;
      finish();
    }, el.duration * 1000 + 2000);
  };
  el.src = `data:${mime};base64,${base64}`;

  // Deliberately generous initial estimate — only a backstop for the case
  // where metadata never loads; the real deadline is set above.
  const estimatedMs = Math.max(8000, (text.length / 8) * 1000 + 4000);
  audioWatchdogTimer = window.setTimeout(() => {
    viaWatchdog = true;
    finish();
  }, estimatedMs);

  onDiag?.("remote audio play() called");
  el.play().catch((err) => fallbackToLocal(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
}

export function speak(text: string, { onEnd, audioBase64, audioMime, lang, onDiag }: SpeakOptions): void {
  if (audioBase64) {
    playRemoteAudio(audioBase64, audioMime ?? "audio/mpeg", text, onEnd, lang, onDiag);
    return;
  }
  speakLocal(text, onEnd, lang, onDiag);
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
