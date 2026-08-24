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

// Consecutive silent no-speech cycles (~8s each) before the session quietly
// returns to idle — ends demonstrably dead sessions without ever cutting off
// a normal thinking pause (spec §2.9).
const MAX_SILENT_CYCLES = 4;

export interface ConversationApi {
  phase: Phase;
  interimTranscript: string;
  errorMessage: string | null;
  micPermissionDenied: boolean;
  mutationSignal: number;
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
  // Counts back-to-back no-speech cycles; reset whenever the user actually
  // says something. Drives the auto-idle above.
  const silentCyclesRef = useRef(0);

  // Plain hoisted function declarations on purpose — openMic, speakThenListen,
  // handleFinalTranscript and handleRecognitionError call each other in a
  // cycle, which const-arrow + useCallback can't express without a temporal-
  // dead-zone error. None of these need referential stability across renders.

  function setPhaseBoth(p: Phase) {
    phaseRef.current = p;
    setPhase(p);
  }

  // The ONLY places this is called: a TTS "end" handler (greeting or reply),
  // or a no-speech restart (which never involved TTS, so there's no echo
  // risk). It is structurally impossible to listen while the AI is talking.
  function openMic() {
    const myEpoch = ++epochRef.current;
    setInterimTranscript("");
    setPhaseBoth("listening");

    recognizerRef.current!.start(
      {
        onInterim: (text) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          setInterimTranscript(text);
        },
        onFinal: (text) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          void handleFinalTranscript(text);
        },
        onError: (kind) => {
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          handleRecognitionError(kind);
        },
        onEnd: () => {
          // Normal completion arrives via onFinal/onError first, and both
          // bump the epoch — so reaching here with a current epoch means
          // recognition died with no result and no error event (browser
          // kill, tab background, phone lock). Treat it as silence rather
          // than sitting deaf on "Listening…" forever.
          if (epochRef.current !== myEpoch || phaseRef.current !== "listening") return;
          handleRecognitionError("no-speech");
        },
      },
      languageRef.current,
    );
  }

  function speakThenListen(text: string, audioBase64?: string | null) {
    epochRef.current++; // invalidate any in-flight recognition before speaking
    setPhaseBoth("speaking");
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
      // User was simply quiet — say nothing, just reopen the mic. Speaking
      // "didn't catch that" here would nag on every silent pause. But after
      // several cycles of pure silence (~30s), the user has walked away:
      // return to idle instead of holding the mic open indefinitely.
      silentCyclesRef.current++;
      if (silentCyclesRef.current >= MAX_SILENT_CYCLES) {
        endSession();
        return;
      }
      openMic();
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
      speakThenListen("Sorry, I didn't catch that.");
      return;
    }

    silentCyclesRef.current = 0; // the user is talking — session is alive
    epochRef.current++;
    setPhaseBoth("thinking"); // set immediately on end-of-speech — never a frozen gap

    try {
      const result = await sendChat(sessionIdRef.current, text);
      setErrorMessage(null);
      if (result.mutated) setMutationSignal((n) => n + 1);
      languageRef.current = result.lang;

      if (result.ended) {
        setPhaseBoth("speaking");
        speak(result.reply_text, {
          audioBase64: result.audio_base64,
          lang: result.lang,
          onEnd: () => setPhaseBoth("idle"),
        });
        return;
      }

      speakThenListen(result.reply_text, result.audio_base64);
    } catch (err) {
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
    silentCyclesRef.current = 0;
    sessionIdRef.current = uuidv4();
    const myEpoch = ++epochRef.current;

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
    epochRef.current++;
    recognizerRef.current!.abort();
    cancelSpeech();
    setInterimTranscript("");
    setPhaseBoth("idle");
  }

  // Barge-in: the user wants to talk over the AI. Silence it and listen.
  // Safe against echo — speech is fully stopped before the mic opens, and
  // the epoch bump discards anything already in flight.
  function interrupt() {
    if (phaseRef.current !== "speaking") return;
    silentCyclesRef.current = 0;
    epochRef.current++;
    cancelSpeech();
    openMic();
  }

  return {
    phase,
    interimTranscript,
    errorMessage,
    micPermissionDenied,
    mutationSignal,
    startSession,
    endTurn,
    endSession,
    interrupt,
  };
}
