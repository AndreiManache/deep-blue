export interface SpeechSupport {
  // Kept named "recognition" for the callers, but now means "can we capture and
  // transcribe" (getUserMedia + MediaRecorder + an AudioContext for VAD).
  recognitionSupported: boolean;
  synthesisSupported: boolean;
  fullySupported: boolean;
}

export function getSpeechSupport(): SpeechSupport {
  const w = window as unknown as {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
    speechSynthesis?: unknown;
  };
  const captureSupported =
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(w.AudioContext || w.webkitAudioContext);

  // Reply audio is served pre-synthesized and played via <audio>, so voice
  // output doesn't depend on speechSynthesis — capture is the only hard
  // requirement for the conversation to work.
  return {
    recognitionSupported: captureSupported,
    synthesisSupported: Boolean(w.speechSynthesis),
    fullySupported: captureSupported,
  };
}
