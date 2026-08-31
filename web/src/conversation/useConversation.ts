import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  ApiError,
  fetchGreeting,
  sendChat,
  synthesizeText,
  transcribeAudio,
  type GreetingResponse,
  type ImageAttachment,
} from "../api/client";
import { SpeechCapture } from "../speech/capture";
import { getSpeechSupport } from "../speech/support";
import { cancelSpeech, speak } from "../speech/synthesis";

export type Phase = "idle" | "awaiting-mic" | "listening" | "thinking" | "speaking" | "unsupported";

// Used when no profile name has been set yet.
const FALLBACK_NAME = "there";

// After the AI finishes speaking, wait this long before opening the mic. We now
// hold the mic stream open for the whole session (see SpeechCapture), so iOS
// stays in record mode; this is just a small guard so the <audio> element is
// fully released first.
const MIC_REARM_DELAY_MS = 250;

// A single line in the on-screen diagnostics log.
export interface DiagEvent {
  t: number; // Date.now()
  label: string;
  detail?: string;
}

export interface ConversationApi {
  phase: Phase;
  interimTranscript: string;
  errorMessage: string | null;
  micPermissionDenied: boolean;
  mutationSignal: number;
  diagnostics: DiagEvent[];
  clearDiagnostics: () => void;
  /**
   * Append to the same diagnostics log the voice pipeline writes to. Exposed
   * so non-conversation features (barcode scanning) can record what happened
   * too — that log is attachable to a feedback report, which is the only way
   * a client-side failure on someone else's phone ever reaches us.
   */
  addDiagnostic: (label: string, detail?: string) => void;
  /** A photo attached ahead of the next spoken turn — see PhotoAttach.tsx. */
  pendingImage: ImageAttachment | null;
  attachImage: (image: ImageAttachment) => void;
  clearImage: () => void;
  startSession: () => void;
  endTurn: () => void;
  endSession: () => void;
  /** Barge-in: cut the AI off mid-reply and open the mic. */
  interrupt: () => void;
  /**
   * Call once known to be authenticated (useConversation() has no auth
   * state of its own) to warm the greeting ahead of the tap that would
   * otherwise fetch it cold — see the ref this populates for why.
   */
  prefetchGreeting: () => void;
}

export function useConversation(): ConversationApi {
  const [phase, setPhase] = useState<Phase>(() =>
    getSpeechSupport().fullySupported ? "idle" : "unsupported",
  );
  const [interimTranscript] = useState(""); // no interim results with batch STT
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [mutationSignal, setMutationSignal] = useState(0);
  const [diagnostics, setDiagnostics] = useState<DiagEvent[]>([]);
  const [pendingImage, setPendingImage] = useState<ImageAttachment | null>(null);
  // Read synchronously inside handleFinalTranscript, which closes over stale
  // state otherwise — same pattern as phaseRef/epochRef below.
  const pendingImageRef = useRef<ImageAttachment | null>(null);

  const captureRef = useRef<SpeechCapture | null>(null);
  if (!captureRef.current) captureRef.current = new SpeechCapture();

  const sessionIdRef = useRef<string>("");
  // BCP-47 tag, refreshed after every /greeting and /chat response so a
  // mid-conversation language switch takes effect immediately (drives TTS).
  const languageRef = useRef<string>("en-US");
  // Every transition bumps this, so a capture/transcribe result that resolves
  // after we've already moved on is ignored.
  const epochRef = useRef(0);
  // A synchronous phase check readable inside async/event callbacks.
  const phaseRef = useRef<Phase>(phase);
  // Populated by prefetchGreeting() (called once the caller knows we're
  // actually authenticated — useConversation() itself has no auth state) —
  // by the time the user taps to start a session, the network round trip
  // (and the server-side TTS synthesis behind it, on a cache miss) has
  // usually already happened, so startSession() sees an already-resolved
  // promise instead of a fresh multi-hundred-ms wait.
  const greetingPrefetchRef = useRef<Promise<GreetingResponse | null> | null>(null);
  function prefetchGreeting() {
    greetingPrefetchRef.current = fetchGreeting().catch(() => null);
  }

  function logDiag(label: string, detail?: string) {
    setDiagnostics((prev) => {
      const next = [...prev, { t: Date.now(), label, detail }];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }

  function clearDiagnostics() {
    setDiagnostics([]);
  }

  function attachImage(image: ImageAttachment) {
    pendingImageRef.current = image;
    setPendingImage(image);
    logDiag("photo attached");
  }

  function clearImage() {
    pendingImageRef.current = null;
    setPendingImage(null);
  }

  // Plain hoisted function declarations on purpose — openMic, speakThenListen
  // and handleFinalTranscript call each other in a cycle.

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function openMic() {
    const myEpoch = ++epochRef.current;
    setPhaseBoth("listening");
    logDiag("listening…");

    const fresh = () => epochRef.current === myEpoch && phaseRef.current === "listening";

    captureRef.current!.listen({
      onSpeechStart: () => {
        if (!fresh()) return;
        logDiag("first audio heard");
      },
      onResult: (blob) => {
        if (!fresh()) return;
        void transcribeAndSend(blob, myEpoch);
      },
      onNoSpeech: () => {
        if (!fresh()) return;
        logDiag("silence — nobody spoke, ending");
        endSession();
      },
      onError: (message) => {
        if (epochRef.current !== myEpoch) return;
        logDiag("capture error", message);
        setErrorMessage("Microphone trouble — tap to try again.");
        endSession();
      },
    });
  }

  async function transcribeAndSend(blob: Blob, myEpoch: number) {
    setPhaseBoth("thinking"); // end of speech — show loading through STT + model
    logDiag("recording stopped, transcribing…", `${Math.round(blob.size / 1024)}KB`);
    const t0 = Date.now();
    let text: string;
    try {
      text = await transcribeAudio(blob);
    } catch {
      logDiag("✕ transcribe failed", `${Date.now() - t0}ms`);
      if (epochRef.current !== myEpoch) return;
      void speakLocalPhrase("Sorry, I didn't catch that.");
      return;
    }
    logDiag("transcript", `"${text}" (${Date.now() - t0}ms)`);
    if (epochRef.current !== myEpoch) return;
    void handleFinalTranscript(text);
  }

  // Local error/recovery phrases ("didn't catch that", a failed /chat's
  // message) used to always fall back to the browser's speechSynthesis,
  // regardless of which premium voice was configured — routes them through
  // the same server TTS as every other reply instead (2026-08-29 backlog
  // item). Falls back to no audio (speakThenListen's own local-voice
  // fallback) on any failure, including a timeout — deliberately, since
  // this runs in error-recovery paths where the network may itself be down.
  async function speakLocalPhrase(text: string) {
    try {
      const result = await synthesizeText(text);
      speakThenListen(text, result.audio_base64, result.audio_mime);
    } catch {
      speakThenListen(text);
    }
  }

  function speakThenListen(text: string, audioBase64?: string | null, audioMime?: string) {
    captureRef.current!.abort(); // never record while the AI talks
    epochRef.current++;
    setPhaseBoth("speaking");
    logDiag("AI speaks", text.slice(0, 60));
    speak(text, {
      audioBase64,
      audioMime,
      lang: languageRef.current,
      onEnd: () => {
        if (phaseRef.current !== "speaking") return; // session may have ended meanwhile
        // Small beat so iOS finishes releasing the <audio> element before the
        // mic re-opens; re-check phase after the wait.
        setTimeout(() => {
          if (phaseRef.current !== "speaking") return;
          openMic();
        }, MIC_REARM_DELAY_MS);
      },
    });
  }

  async function handleFinalTranscript(text: string) {
    if (!text || text.trim().length === 0) {
      logDiag("heard nothing usable");
      void speakLocalPhrase("Sorry, I didn't catch that.");
      return;
    }

    const myEpoch = ++epochRef.current;
    setPhaseBoth("thinking");

    // A photo describes only the very next turn — consumed here regardless
    // of outcome, so it never silently attaches to a later, unrelated turn.
    const image = pendingImageRef.current;
    if (image) clearImage();

    const startedAt = Date.now();
    logDiag("→ request sent", image ? "with photo" : undefined);
    try {
      const result = await sendChat(sessionIdRef.current, text, image);
      logDiag("← reply", `${Date.now() - startedAt}ms${result.ended ? " (ends session)" : ""}`);
      // The food-logging side effect already happened server-side regardless
      // of what the UI does with it, so let the Dashboard know even if the
      // session ended while this was in flight.
      if (result.mutated) setMutationSignal((n) => n + 1);
      if (epochRef.current !== myEpoch) return; // endSession() fired while we were waiting — don't reopen the mic or speak into a session that's over
      setErrorMessage(null);
      languageRef.current = result.lang;

      if (result.ended) {
        captureRef.current!.abort();
        setPhaseBoth("speaking");
        logDiag("AI speaks", result.reply_text.slice(0, 60));
        speak(result.reply_text, {
          audioBase64: result.audio_base64,
          audioMime: result.audio_mime,
          lang: result.lang,
          onEnd: () => endSession(),
        });
        return;
      }

      speakThenListen(result.reply_text, result.audio_base64, result.audio_mime);
    } catch (err) {
      logDiag("✕ request failed", `${Date.now() - startedAt}ms`);
      if (epochRef.current !== myEpoch) return; // endSession() fired while we were waiting
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setErrorMessage(message);
      void speakLocalPhrase(message);
    }
  }

  async function startSession() {
    if (!getSpeechSupport().fullySupported) {
      setPhaseBoth("unsupported");
      return;
    }
    setMicPermissionDenied(false);
    setErrorMessage(null);
    sessionIdRef.current = uuidv4();
    const myEpoch = ++epochRef.current;
    logDiag("── tap → start session ──");

    // Acquire (and hold) the mic inside the tap gesture. The greeting was
    // already kicked off on mount (see greetingPrefetchRef above) — reuse
    // that instead of starting a fresh fetch, unless it's already been
    // consumed by an earlier session this app-load (or never started, e.g.
    // the effect hasn't run yet), in which case fall back to fetching now.
    // Cleared after use so a later session in the same app-load re-checks
    // the name/language rather than replaying a possibly-stale greeting.
    const permission = captureRef.current!.acquire();
    const greeting = greetingPrefetchRef.current ?? fetchGreeting().catch(() => null);
    greetingPrefetchRef.current = null;

    setPhaseBoth("awaiting-mic");
    const granted = await permission;
    if (epochRef.current !== myEpoch) return; // endSession() fired while we waited
    logDiag("mic permission", granted);
    if (granted === "denied") {
      setMicPermissionDenied(true);
      setPhaseBoth("idle");
      return;
    }
    if (granted === "unavailable") {
      setErrorMessage("Microphone isn't available in this browser.");
      setPhaseBoth("idle");
      return;
    }

    setPhaseBoth("thinking"); // permission settled; greeting may still be loading

    let text = `Hello ${FALLBACK_NAME}`;
    let audioBase64: string | null = null;
    let audioMime: string | undefined;
    const result = await greeting;
    if (result) {
      text = result.text;
      audioBase64 = result.audio_base64;
      audioMime = result.audio_mime;
      languageRef.current = result.lang;
    }

    if (epochRef.current !== myEpoch) return; // endSession() fired while we were fetching
    speakThenListen(text, audioBase64, audioMime);
  }

  // Manual "tap to end my turn": stop recording now and transcribe what we have.
  function endTurn() {
    if (phaseRef.current === "listening") {
      captureRef.current!.stopTurn();
    }
  }

  function endSession() {
    epochRef.current++;
    captureRef.current!.release(); // stops the held mic stream — session over
    cancelSpeech();
    setPhaseBoth("idle");
    logDiag("session ended");
  }

  // Barge-in: talk over the AI. Silence it and listen. The held stream is still
  // open, so this just re-opens the mic; the epoch bump discards any in-flight
  // transcription.
  function interrupt() {
    if (phaseRef.current !== "speaking") return;
    epochRef.current++;
    cancelSpeech();
    logDiag("barge-in");
    openMic();
  }

  return {
    phase,
    interimTranscript,
    errorMessage,
    micPermissionDenied,
    mutationSignal,
    diagnostics,
    clearDiagnostics,
    addDiagnostic: logDiag,
    pendingImage,
    attachImage,
    clearImage,
    startSession,
    endTurn,
    endSession,
    interrupt,
    prefetchGreeting,
  };
}
