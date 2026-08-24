// The browser only asks for microphone permission when something actually
// opens the mic. Left alone, that moment is SpeechRecognition's start() call
// inside openMic() — which runs right after the greeting finishes speaking.
// So a first-time user hears "Hello Andrei", starts answering, and their
// words go nowhere: the permission prompt is still up and nothing is
// capturing yet. On mobile the prompt covers the page, which makes it look
// like the app simply isn't listening. Asking up front, inside the tap that
// starts the session, moves the prompt ahead of everything that's spoken.

export type MicPermission = "granted" | "denied" | "unavailable";

// Only an optimization: skip re-opening the device when permission is
// already on record. The Permissions API isn't universal (Firefox has no
// "microphone" descriptor and throws on it), so any failure means "don't
// know" — which just falls through to getUserMedia.
async function isAlreadyGranted(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    return status?.state === "granted";
  } catch {
    return false;
  }
}

// "unavailable" is deliberately not a failure. An insecure origin (plain
// http:// that isn't localhost) exposes no navigator.mediaDevices at all,
// and device-level errors are better reported by SpeechRecognition's own
// onerror than guessed at here — in both cases the session proceeds exactly
// as it did before. Only an explicit refusal counts as "denied".
export async function ensureMicPermission(): Promise<MicPermission> {
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
  if (await isAlreadyGranted()) return "granted";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // The permission was the whole point — SpeechRecognition opens its own
    // capture. Holding this stream would pin the browser's recording
    // indicator on for the entire session.
    for (const track of stream.getTracks()) track.stop();
    return "granted";
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
  }
}
