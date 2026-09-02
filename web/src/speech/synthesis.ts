// Speech-output paths sharing one { onEnd } contract, so callers don't care
// which is actually playing. Tried in order:
//  - Web Audio (a BufferSource on the app's shared AudioContext) for real AI
//    replies. This is the PRIMARY path (2026-09-02): iOS Safari blocks both
//    <audio>.play() and speechSynthesis.speak() when they're called outside
//    a user gesture, which every reply is (it plays ~3s after the button
//    release, at the end of the STT→chat→TTS chain). A Web Audio context
//    that was resume()'d during the button press, though, keeps playing
//    whatever's scheduled on it afterwards — proven live, since the ready
//    chime (same context) is the one sound that reliably plays on iOS.
//  - The <audio> element — kept as a fallback for engines where Web Audio
//    decode fails but element playback works.
//  - The browser's speechSynthesis for canned local phrases (greeting,
//    "didn't catch that", network errors) and as the last-resort fallback —
//    zero cost, zero network, works even if TTS is down.
//
// speechSynthesis workarounds (unchanged from the original implementation):
//  - a stuck/paused queue is cleared before every speak() call
//  - the utterance is kept in a module-level variable, because Chrome can
//    garbage-collect it mid-speech and silently drop the `onend` event
//  - a duration-estimate watchdog force-finishes if `onend` never fires
//  - a resume() keepalive works around Chrome pausing utterances after ~15s
// The <audio> path gets its own simpler watchdog — standard HTMLMediaElement
// events are far more reliable than speechSynthesis's, so it needs less.
import { getAudioContext } from "./audioContext";

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

// The Web Audio reply currently playing (for cancel/barge-in), and its own
// watchdog + finished-guard.
let currentSource: AudioBufferSourceNode | null = null;
let webAudioWatchdogTimer: number | null = null;

function clearWebAudioWatchdog(): void {
  if (webAudioWatchdogTimer !== null) {
    window.clearTimeout(webAudioWatchdogTimer);
    webAudioWatchdogTimer = null;
  }
}

function stopCurrentSource(): void {
  if (currentSource) {
    currentSource.onended = null;
    try {
      currentSource.stop();
    } catch {
      /* already stopped */
    }
    currentSource = null;
  }
}

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

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// decodeAudioData has both a modern promise form and an old Safari
// callback-only form — cover both so this works everywhere.
function decodeAudio(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ok = (buf: AudioBuffer) => {
      if (!settled) {
        settled = true;
        resolve(buf);
      }
    };
    const fail = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    try {
      const maybe = ctx.decodeAudioData(data, ok, fail) as unknown as Promise<AudioBuffer> | undefined;
      if (maybe && typeof maybe.then === "function") maybe.then(ok, fail);
    } catch (err) {
      fail(err);
    }
  });
}

// PRIMARY reply path — see the file header for why this beats <audio> on iOS.
// Falls back to the <audio> element (which then falls back to the local
// voice) if the context is missing, decode fails, or playback throws.
function playViaWebAudio(
  base64: string,
  mime: string,
  text: string,
  onEnd: () => void,
  lang?: string,
  onDiag?: (label: string, detail?: string) => void,
): void {
  const ctx = getAudioContext();
  if (!ctx) {
    onDiag?.("no AudioContext — using <audio> element instead");
    playRemoteAudio(base64, mime, text, onEnd, lang, onDiag);
    return;
  }

  const toElement = (reason: string) => {
    onDiag?.("web audio failed, trying <audio> element", reason);
    playRemoteAudio(base64, mime, text, onEnd, lang, onDiag);
  };

  // Resume defensively — normally already running from the button press, but
  // a context can get re-suspended by the OS between turns.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  decodeAudio(ctx, base64ToArrayBuffer(base64))
    .then((buffer) => {
      stopCurrentSource();
      clearWebAudioWatchdog();

      let done = false;
      const finish = (via: string) => {
        if (done) return;
        done = true;
        clearWebAudioWatchdog();
        if (currentSource === source) currentSource = null;
        onDiag?.("web audio reply finished", via);
        onEnd();
      };

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => finish("onended");
      currentSource = source;

      onDiag?.("speaking via web audio", `${buffer.duration.toFixed(1)}s, ctx ${ctx.state}`);
      source.start();

      // Backstop in case onended never fires (some engines drop it) — buffer
      // duration is exact, so this only ever fires slightly late, never mid-reply.
      webAudioWatchdogTimer = window.setTimeout(() => finish("watchdog"), buffer.duration * 1000 + 2000);
    })
    .catch((err) => toElement(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
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
    playViaWebAudio(audioBase64, audioMime ?? "audio/mpeg", text, onEnd, lang, onDiag);
    return;
  }
  speakLocal(text, onEnd, lang, onDiag);
}

export function cancelSpeech(): void {
  clearTimers();
  currentUtterance = null;
  window.speechSynthesis?.cancel();

  clearWebAudioWatchdog();
  stopCurrentSource();

  clearAudioWatchdog();
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
}
