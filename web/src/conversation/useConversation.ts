import { useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { ApiError, fetchGreeting, sendChat } from "../api/client";
import type { RecognitionErrorKind } from "../speech/recognition";
import { SpeechRecognizer } from "../speech/recognition";
import { getSpeechSupport } from "../speech/support";
import { cancelSpeech, speak } from "../speech/synthesis";

export type Phase = "idle" | "listening" | "thinking" | "speaking" | "unsupported";

// Used when no profile name has been set yet.
const FALLBACK_NAME = "there";

export interface ConversationApi {
  phase: Phase;
  interimTranscript: string;
  errorMessage: string | null;
  micPermissionDenied: boolean;
  mutationSignal: number;
  startSession: () => void;
  endTurn: () => void;
  endSession: () => void;
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
          // Normal completion is handled via onFinal/onError above.
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
      onEnd: () => {
        if (phaseRef.current !== "speaking") return; // session may have ended meanwhile
        openMic();
      },
    });
  }

  function handleRecognitionError(kind: RecognitionErrorKind) {
    if (kind === "no-speech") {
      // User was simply quiet — say nothing, just reopen the mic. Speaking
      // "didn't catch that" here would nag on every silent pause.
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

    epochRef.current++;
    setPhaseBoth("thinking"); // set immediately on end-of-speech — never a frozen gap

    try {
      const result = await sendChat(sessionIdRef.current, text);
      setErrorMessage(null);
      if (result.mutated) setMutationSignal((n) => n + 1);
      languageRef.current = result.lang;

      if (result.ended) {
        setPhaseBoth("speaking");
        speak(result.reply_text, { audioBase64: result.audio_base64, onEnd: () => setPhaseBoth("idle") });
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
    sessionIdRef.current = uuidv4();
    setPhaseBoth("thinking"); // immediate feedback while the greeting loads
    const myEpoch = ++epochRef.current;

    // Same voice pipeline as real replies (ElevenLabs, with an automatic
    // speechSynthesis fallback baked into speakThenListen/speak) — a failed
    // fetch here just falls back to the local placeholder greeting text.
    let text = `Hello ${FALLBACK_NAME}`;
    let audioBase64: string | null = null;
    try {
      const greeting = await fetchGreeting();
      text = greeting.text;
      audioBase64 = greeting.audio_base64;
      languageRef.current = greeting.lang;
    } catch {
      // a failed greeting fetch shouldn't block starting the conversation
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

  return {
    phase,
    interimTranscript,
    errorMessage,
    micPermissionDenied,
    mutationSignal,
    startSession,
    endTurn,
    endSession,
  };
}
