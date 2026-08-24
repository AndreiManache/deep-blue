// Thin wrapper around the browser's SpeechRecognition. Deliberately dumb —
// it has no notion of conversation phase or turn epoch. Callers (the
// conversation state machine) decide whether a result should be acted on;
// see useConversation.ts for the echo-guard layers.

export type RecognitionErrorKind =
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed"
  | "audio-capture"
  | "network"
  | "aborted"
  | "other";

export interface RecognitionHandlers {
  onInterim?: (transcript: string) => void;
  onFinal: (transcript: string) => void;
  onError: (kind: RecognitionErrorKind) => void;
  onEnd: () => void;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function getConstructor(): SpeechRecognitionConstructor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function normalizeError(error: string): RecognitionErrorKind {
  switch (error) {
    case "no-speech":
    case "not-allowed":
    case "service-not-allowed":
    case "audio-capture":
    case "network":
    case "aborted":
      return error;
    default:
      return "other";
  }
}

export class SpeechRecognizer {
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;

  get isSupported(): boolean {
    return Boolean(getConstructor());
  }

  start(handlers: RecognitionHandlers, lang: string = "en-US"): void {
    if (this.listening) return; // guard against InvalidStateError on double-start
    const Ctor = getConstructor();
    if (!Ctor) {
      handlers.onError("other");
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }
      if (interimTranscript && handlers.onInterim) handlers.onInterim(interimTranscript);
      if (finalTranscript) handlers.onFinal(finalTranscript.trim());
    };

    recognition.onerror = (event) => {
      handlers.onError(normalizeError(event.error));
    };

    recognition.onend = () => {
      this.listening = false;
      this.recognition = null;
      handlers.onEnd();
    };

    this.recognition = recognition;
    this.listening = true;
    try {
      recognition.start();
    } catch {
      this.listening = false;
      this.recognition = null;
      handlers.onError("other");
    }
  }

  /** Ends listening but still delivers a pending final result — used by the manual "tap to end my turn" fallback. */
  stop(): void {
    this.recognition?.stop();
  }

  /** Ends listening and discards any pending result — used before TTS speaks, so the mic can never hear the AI's own voice. */
  abort(): void {
    this.recognition?.abort();
    this.listening = false;
    this.recognition = null;
  }
}
