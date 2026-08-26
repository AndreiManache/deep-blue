import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ApiError, fetchGreeting, sendChat } from "../api/client";
import type { RecognitionErrorKind } from "../speech/recognition";
import { SpeechRecognizer } from "../speech/recognition";
import { ensureMicPermission } from "../speech/permission";
import { getSpeechSupport } from "../speech/support";
import { cancelSpeech, speak } from "../speech/synthesis";

export type Phase = "idle" | "awaiting-mic" | "listening" | "thinking" | "speaking" | "unsupported";

// Used when no profile name has been set yet.
const FALLBACK_NAME = "there";

// End the conversation after this long listening with nobody saying anything.
// The timer is cleared the moment any speech is detected, so it only fires on
// true silence — which also means a session never hangs on "Listening…" when
// the mic delivers no audio at all (the iOS "didn't hear me" case).
const SILENCE_TIMEOUT_MS = 3000;

// A single line in the on-screen diagnostics log. Timestamped so the UI can
// show wall-clock time and the delta between events (which is where latency
// shows up).
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
  startSession: () => void;
  endTurn: () => void;
  endSession: () => void;
  /** Barge-in: cut the AI off mid-reply and open the mic. */
  interrupt: () => void;
}

export function useConversation(): ConversationApi {
  const [phase, setPhase] = useState<Phase>(() =>
    getSpeechSupport().fullySupported ? "idle" : "unsupported",
  );
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [mutationSignal, setMutationSignal] = useState(0);
  const [diagnostics, setDiagnostics] = useState<DiagEvent[]>([]);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  if (!recognizerRef.current) recognizerRef.current = new SpeechRecognizer();

  const sessionIdRef = useRef<string>("");
  // BCP-47 tag for SpeechRecognition, resolved from the profile's language
  // preference — refreshed after every /greeting and /chat response so a
  // mid-conversation language switch takes effect on the very next listen.
  const languageRef = useRef<string>("en-US");
  // Layer 3 of the echo guard: every transition bumps this, so a recognition
  // event that resolves after we've already moved on is ignored.
  const epochRef = useRef(0);
  // Layer 4: a synchronous phase check readable inside async/event callbacks
  // (React state itself is stale inside closures until the next render).
  const phaseRef = useRef<Phase>(phase);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Append to the diagnostics log (capped so a long session can't grow it
  // without bound). Kept cheap — plain state, no refs to read back.
  function logDiag(label: string, detail?: string) {
    setDiagnostics((prev) => {
      const next = [...prev, { t: Date.now(), label, detail }];
      return next.length > 300 ? next.slice(next.length - 300) : next;
    });
  }

  function clearDiagnostics() {
    setDiagnostics([]);
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  // Plain hoisted function declarations on purpose — openMic, speakThenListen,
  // handleFinalTranscript and handleRecognitionError call each other in a
  // cycle, which const-arrow + useCallback can't express without a temporal-
  // dead-zone error. None of these need referential stability across renders.

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  // The ONLY places this is called: a TTS "end" handler (greeting or reply),
  // or a barge-in. It is structurally impossible to listen while the AI talks.
  function openMic() {
    clearSilenceTimer();
    const myEpoch = ++epochRef.current;
    setInterimTranscript("");
    setPhaseBoth("listening");
    logDiag("listening…");

    // Closure-local: was any speech heard in THIS listening window?
    let heard = false;

    silenceTimerRef.current = setTimeout(() => {
      if (epochRef.current !== myEpoch || phaseRef.current !== "listening" || heard) return;
      logDiag("silence — nobody spoke for 3s, ending");
      endSession();
    }, SILENCE_TIMEOUT_MS);

    recognizerRef.current!.start(
      {
        onInterim: (text) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          if (!heard) {
            heard = true;
            clearSilenceTimer();
            logDiag("first audio heard", text);
          }
          setInterimTranscript(text);
        },
        onFinal: (text) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          clearSilenceTimer();
          void handleFinalTranscript(text);
        },
        onError: (kind) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          clearSilenceTimer();
          logDiag("recognition error", kind);
          handleRecognitionError(kind);
        },
        onEnd: () => {
          // Normal completion arrives via onFinal/onError first, and both
          // bump the epoch — so reaching here with a current epoch means
          // recognition died with no result and no error event (browser
          // kill, tab background, phone lock). Treat it as silence.
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          clearSilenceTimer();
          logDiag("recognition ended with no result");
          handleRecognitionError("no-speech");
        },
      },
      languageRef.current,
    );
  }

  function speakThenListen(text: string, audioBase64?: string | null) {
    clearSilenceTimer();
    epochRef.current++; // invalidate any in-flight recognition before speaking
    setPhaseBoth("speaking");
    logDiag("AI speaks", text.slice(0, 60));
    speak(text, {
      audioBase64,
      lang: languageRef.current,
      onEnd: () => {
        if (phaseRef.current !== "speaking") return; // session may have ended meanwhile
        openMic();
      },
    });
  }

  function handleRecognitionError(kind: RecognitionErrorKind) {
    if (kind === "no-speech") {
      // Silence ends the conversation (per the 3s-silence rule) rather than
      // holding the mic open. The timer above usually fires first; this is the
      // backstop for a browser that raises no-speech on its own.
      endSession();
      return;
    }
    if (kind === "aborted") {
      return; // we caused this ourselves (abort before speaking / ending session)
    }
    epochRef.current++;
    if (kind === "not-allowed" || kind === "service-not-allowed") {
      setMicPermissionDenied(true);
      setPhaseBoth("idle");
      return;
    }
    // audio-capture, network, other: treat as an unusable transcript.
    speakThenListen("Sorry, I didn't catch that.");
  }

  async function handleFinalTranscript(text: string) {
    if (!text || text.trim().length === 0) {
      logDiag("heard nothing usable");
      speakThenListen("Sorry, I didn't catch that.");
      return;
    }

    logDiag("heard", text);
    epochRef.current++;
    setPhaseBoth("thinking"); // set immediately on end-of-speech — never a frozen gap

    const startedAt = Date.now();
    logDiag("→ request sent");
    try {
      const result = await sendChat(sessionIdRef.current, text);
      logDiag("← reply", `${Date.now() - startedAt}ms${result.ended ? " (ends session)" : ""}`);
      setErrorMessage(null);
      if (result.mutated) setMutationSignal((n) => n + 1);
      languageRef.current = result.lang;

      if (result.ended) {
        setPhaseBoth("speaking");
        logDiag("AI speaks", result.reply_text.slice(0, 60));
        speak(result.reply_text, {
          audioBase64: result.audio_base64,
          lang: result.lang,
          onEnd: () => setPhaseBoth("idle"),
        });
        return;
      }

      speakThenListen(result.reply_text, result.audio_base64);
    } catch (err) {
      logDiag("✕ request failed", `${Date.now() - startedAt}ms`);
      const message = err instanceof ApiError ? err.message : "Something went wrong. Try again.";
      setErrorMessage(message);
      speakThenListen(message);
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

    // Both started before the first await, so the permission prompt is
    // raised inside this tap's own user gesture, and the greeting downloads
    // while the user is deciding — waiting on the prompt costs no time.
    // Nothing may be SPOKEN until permission settles: the greeting playing
    // over a prompt the user hasn't answered yet is the whole bug (they
    // answer the greeting, the mic isn't capturing, the words vanish).
    const permission = ensureMicPermission();
    const greeting = fetchGreeting().catch(() => null);

    setPhaseBoth("awaiting-mic");
    const granted = await permission;
    if (epochRef.current !== myEpoch) return; // endSession() fired while we waited
    logDiag("mic permission", granted);
    if (granted === "denied") {
      setMicPermissionDenied(true);
      setPhaseBoth("idle");
      return;
    }

    setPhaseBoth("thinking"); // permission settled; greeting may still be loading

    // Same voice pipeline as real replies (ElevenLabs, with an automatic
    // speechSynthesis fallback baked into speakThenListen/speak) — a failed
    // fetch here just falls back to the local placeholder greeting text.
    let text = `Hello ${FALLBACK_NAME}`;
    let audioBase64: string | null = null;
    const result = await greeting;
    if (result) {
      text = result.text;
      audioBase64 = result.audio_base64;
      languageRef.current = result.lang;
    }

    if (epochRef.current !== myEpoch) return; // endSession() fired while we were fetching
    speakThenListen(text, audioBase64);
  }

  // Manual "tap to end my turn" fallback (spec §9), for when end-of-speech
  // detection misfires. stop() (not abort()) so a pending result still lands.
  function endTurn() {
    if (phaseRef.current === "listening") {
      recognizerRef.current!.stop();
    }
  }

  function endSession() {
    clearSilenceTimer();
    epochRef.current++;
    recognizerRef.current!.abort();
    cancelSpeech();
    setInterimTranscript("");
    setPhaseBoth("idle");
    logDiag("session ended");
  }

  // Barge-in: the user wants to talk over the AI. Silence it and listen.
  // Safe against echo — speech is fully stopped before the mic opens, and
  // the epoch bump discards anything already in flight.
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
    startSession,
    endTurn,
    endSession,
    interrupt,
  };
}
