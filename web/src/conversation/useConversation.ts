import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ApiError, sendChat, synthesizeText, transcribeAudio, type ImageAttachment } from "../api/client";
import { SpeechCapture, type MicPermission } from "../speech/capture";
import { getSpeechSupport } from "../speech/support";
import { cancelSpeech, speak } from "../speech/synthesis";

export type Phase = "idle" | "awaiting-mic" | "listening" | "thinking" | "speaking" | "unsupported";

// Hold-to-talk (2026-09-01 interaction redesign, ticket #13): press the orb
// to talk, release to send. A hold shorter than this is almost certainly an
// accidental tap, not a real turn — discarded silently rather than sent.
const MIN_HOLD_MS = 200;
// No activity (no hold) for this long quietly ends the session — releases
// the mic and resets conversation context, with no spoken goodbye. The user
// never has to explicitly "end" anything; it just fades out on its own.
const IDLE_TIMEOUT_MS = 75000;
// Barging in cuts the AI's audio off immediately, but iOS needs a beat to
// finish flipping its audio session back from playback to record before a
// new MediaRecorder reliably captures anything (see capture.ts's header) —
// this is that beat, only paid when actually interrupting speech.
const BARGE_IN_REARM_DELAY_MS = 150;

// A single line in the on-screen diagnostics log.
export interface DiagEvent {
  t: number; // Date.now()
  label: string;
  detail?: string;
}

export interface ConversationApi {
  phase: Phase;
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
  /** Press the talk button: always wins, even mid-AI-reply (barge-in). */
  holdStart: () => void;
  /** Release the talk button: stop recording and send the turn. */
  holdEnd: () => void;
  /** Hard stop — releases the mic entirely and ends the session right now. */
  endSession: () => void;
  /** Re-prompts for mic permission without starting to record — for the "Try again" retry button. */
  requestMicPermission: () => void;
}

export function useConversation(): ConversationApi {
  const [phase, setPhase] = useState<Phase>(() =>
    getSpeechSupport().fullySupported ? "idle" : "unsupported",
  );
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
  // Re-registered every render (cheap, always current closures) rather than
  // via useEffect — SpeechCapture just holds the latest reference, nothing
  // to clean up between renders.
  captureRef.current.onInterrupted(() => {
    // Idle already means nothing was actually happening — the OS took the
    // mic for a call, say, but there was no turn to interrupt, so there's
    // nothing to recover from and no reason to surface anything.
    if (phaseRef.current === "idle" || phaseRef.current === "unsupported") return;
    logDiag("mic interrupted (phone call?)");
    heldRef.current = false;
    epochRef.current++; // invalidate anything still in flight from the interrupted turn
    cancelSpeech();
    setErrorMessage("Looks like you got interrupted — press and hold to continue.");
    setPhaseBoth("idle");
    scheduleIdleTimeout();
  });

  const sessionIdRef = useRef<string>("");
  // BCP-47 tag, refreshed after every /chat response so a mid-conversation
  // language switch takes effect immediately (drives TTS).
  const languageRef = useRef<string>("en-US");
  // Every transition bumps this, so a capture/transcribe/chat result that
  // resolves after we've already moved on (barge-in, idle timeout, a newer
  // hold) is ignored.
  const epochRef = useRef(0);
  // A synchronous phase check readable inside async/event callbacks.
  const phaseRef = useRef<Phase>(phase);
  // Whether the button is physically down right now — distinct from `phase`,
  // since phase can still say "awaiting-mic" or "speaking" (mid-barge-in
  // rearm delay) for a moment after a very quick press-and-release.
  const heldRef = useRef(false);
  const holdStartedAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  function clearIdleTimer() {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  // No spoken goodbye — the conversation just quietly stops listening for a
  // new hold. Scheduled after every turn settles back to idle.
  function scheduleIdleTimeout() {
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      logDiag("idle timeout — session ended quietly");
      endSession();
    }, IDLE_TIMEOUT_MS);
  }

  // Common "give up and go back to idle" path for holdStart's early-exit
  // checkpoints (released before permission resolved, permission denied,
  // mic unavailable, or a capture error) — always leaves things in a state
  // where the next hold starts clean.
  function bailToIdle(permission?: MicPermission) {
    if (permission === "denied") setMicPermissionDenied(true);
    else if (permission === "unavailable") setErrorMessage("Microphone isn't available in this browser.");
    setPhaseBoth("idle");
    scheduleIdleTimeout();
  }

  // Plain hoisted function declarations on purpose — several of these call
  // each other in a cycle.

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
  // item). Falls back to no audio (speakThenIdle's own local-voice
  // fallback) on any failure, including a timeout — deliberately, since
  // this runs in error-recovery paths where the network may itself be down.
  async function speakLocalPhrase(text: string) {
    try {
      const result = await synthesizeText(text);
      speakThenIdle(text, result.audio_base64, result.audio_mime);
    } catch {
      speakThenIdle(text);
    }
  }

  // AI finishes talking, then goes back to idle (never auto-reopens the mic
  // — hold-to-talk means the user always presses again to keep going).
  function speakThenIdle(text: string, audioBase64?: string | null, audioMime?: string) {
    epochRef.current++; // invalidate anything still pending from the network phase
    setPhaseBoth("speaking");
    logDiag("AI speaks", text.slice(0, 60));
    speak(text, {
      audioBase64,
      audioMime,
      lang: languageRef.current,
      onDiag: logDiag,
      onEnd: () => {
        if (phaseRef.current !== "speaking") return; // barged in, or session ended meanwhile
        setPhaseBoth("idle");
        scheduleIdleTimeout();
      },
    });
  }

  async function handleFinalTranscript(rawText: string) {
    // A photo attached with nothing said is a real, deliberate way to log —
    // "just send a picture, no talking needed" (ticket #20) — rather than a
    // failed turn. Only bail on empty speech when there's nothing else (no
    // photo) for the model to go on. Deliberately honest rather than a
    // fabricated command ("log this food") — this same string becomes the
    // entry's raw_transcript, and the detail modal shows that verbatim as
    // "what you said" whenever it differs from the food's name, so it must
    // never look like a quote from the user.
    const text = rawText && rawText.trim().length > 0 ? rawText : pendingImageRef.current ? "(no words spoken — logging from the photo)" : "";
    if (!text) {
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
      if (epochRef.current !== myEpoch) return; // superseded while we were waiting — don't speak into a session that's moved on
      setErrorMessage(null);
      languageRef.current = result.lang;

      if (result.ended) {
        setPhaseBoth("speaking");
        logDiag("AI speaks", result.reply_text.slice(0, 60));
        speak(result.reply_text, {
          audioBase64: result.audio_base64,
          audioMime: result.audio_mime,
          lang: result.lang,
          onDiag: logDiag,
          onEnd: () => endSession(),
        });
        return;
      }

      speakThenIdle(result.reply_text, result.audio_base64, result.audio_mime);
    } catch (err) {
      logDiag("✕ request failed", `${Date.now() - startedAt}ms`);
      if (epochRef.current !== myEpoch) return; // superseded while we were waiting
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setErrorMessage(message);
      void speakLocalPhrase(message);
    }
  }

  // Press the talk button. Always wins immediately, regardless of what's
  // currently happening — idle, still thinking about the last turn, or the
  // AI mid-reply (barge-in: cuts it off and starts listening right away),
  // like a real walkie-talkie.
  async function holdStart() {
    if (!getSpeechSupport().fullySupported) {
      setPhaseBoth("unsupported");
      return;
    }
    if (heldRef.current) return; // already holding — ignore a duplicate press
    heldRef.current = true;
    clearIdleTimer();
    setErrorMessage(null);

    const wasSpeaking = phaseRef.current === "speaking";
    if (wasSpeaking) {
      cancelSpeech();
      logDiag("barge-in");
    }
    captureRef.current!.abort(); // discard any stray recorder state defensively
    const myEpoch = ++epochRef.current; // invalidates any in-flight thinking/speaking continuation

    if (!sessionIdRef.current) {
      sessionIdRef.current = uuidv4();
      logDiag("── hold → new session ──");
    } else {
      logDiag("── hold ──");
    }

    if (wasSpeaking) {
      await new Promise((resolve) => setTimeout(resolve, BARGE_IN_REARM_DELAY_MS));
      if (epochRef.current !== myEpoch) return; // superseded meanwhile
      if (!heldRef.current) {
        bailToIdle();
        return;
      }
    }

    const alreadyAcquired = captureRef.current!.isAcquired;
    if (!alreadyAcquired) setPhaseBoth("awaiting-mic");
    const granted = await captureRef.current!.acquire();
    if (epochRef.current !== myEpoch) return; // superseded meanwhile

    if (!heldRef.current) {
      // Released before permission even resolved — settle without recording.
      bailToIdle(granted);
      return;
    }
    if (granted !== "granted") {
      heldRef.current = false;
      bailToIdle(granted);
      return;
    }

    setMicPermissionDenied(false);
    holdStartedAtRef.current = Date.now();
    setPhaseBoth("listening");
    logDiag("listening (held)…");

    captureRef.current!.startTurn({
      onResult: (blob) => {
        if (epochRef.current !== myEpoch) return;
        void transcribeAndSend(blob, myEpoch);
      },
      onError: (message) => {
        if (epochRef.current !== myEpoch) return;
        logDiag("capture error", message);
        setErrorMessage("Microphone trouble — try again.");
        bailToIdle();
      },
    });
  }

  // Release the talk button: stop recording and send whatever was captured.
  // A hold under MIN_HOLD_MS is treated as an accidental tap and discarded.
  function holdEnd() {
    if (!heldRef.current) return;
    heldRef.current = false;
    // Still awaiting-mic (permission not resolved yet) or mid barge-in rearm
    // delay — holdStart's own continuation settles state once it resumes.
    if (phaseRef.current !== "listening") return;

    const heldMs = Date.now() - holdStartedAtRef.current;
    if (heldMs < MIN_HOLD_MS) {
      captureRef.current!.abort();
      setPhaseBoth("idle");
      scheduleIdleTimeout();
      return;
    }
    captureRef.current!.endTurn(); // -> onResult -> transcribeAndSend
  }

  // Re-requests mic permission without starting to record — used by the
  // "Try again" button on the permission-denied screen. A real hold (press
  // + release) is what actually starts listening; this only settles the
  // permission prompt itself.
  async function requestMicPermission() {
    setErrorMessage(null);
    const granted = await captureRef.current!.acquire();
    if (granted === "denied") {
      setMicPermissionDenied(true);
      return;
    }
    if (granted === "unavailable") {
      setErrorMessage("Microphone isn't available in this browser.");
      return;
    }
    setMicPermissionDenied(false);
  }

  function endSession() {
    heldRef.current = false;
    clearIdleTimer();
    epochRef.current++;
    captureRef.current!.release(); // stops the held mic stream — session over
    cancelSpeech();
    sessionIdRef.current = ""; // next hold starts a fresh conversation
    setPhaseBoth("idle");
    logDiag("session ended");
  }

  return {
    phase,
    errorMessage,
    micPermissionDenied,
    mutationSignal,
    diagnostics,
    clearDiagnostics,
    addDiagnostic: logDiag,
    pendingImage,
    attachImage,
    clearImage,
    holdStart,
    holdEnd,
    endSession,
    requestMicPermission,
  };
}
