export interface SpeechSupport {
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  fullySupported: boolean;
}

export function getSpeechSupport(): SpeechSupport {
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
    speechSynthesis?: unknown;
  };
  const recognitionSupported = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  const synthesisSupported = Boolean(w.speechSynthesis);
  return {
    recognitionSupported,
    synthesisSupported,
    fullySupported: recognitionSupported && synthesisSupported,
  };
}
