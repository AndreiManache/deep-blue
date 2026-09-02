// Client-side audio capture that replaces the browser's webkitSpeechRecognition.
// It holds ONE microphone stream open for the whole session (which keeps iOS in
// record mode, so a turn right after the AI speaks is never starved of audio —
// the bug that plagued the Web Speech API), and records each turn with
// MediaRecorder for exactly as long as the talk button is held (2026-09-01
// hold-to-talk redesign, ticket #13) — no silence-based VAD deciding when a
// turn ends. The recorded blob goes to the server for transcription
// (ElevenLabs Scribe); there are no interim results.

export type MicPermission = "granted" | "denied" | "unavailable";

export interface CaptureHandlers {
  /** The turn's audio is ready (button released, or the runaway-hold cap fired). */
  onResult: (blob: Blob) => void;
  onError: (message: string) => void;
}

// Purely a runaway guard for a stuck hold (e.g. a lost pointerup event) — NOT
// a normal way for a turn to end. A real end is always the button release.
const MAX_TURN_MS = 120000;

function pickMimeType(): string {
  const prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of prefs) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some engines — treat as unsupported */
    }
  }
  return ""; // let the engine choose (iOS Safari picks audio/mp4)
}

export class SpeechCapture {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private maxTurnTimer: ReturnType<typeof setTimeout> | null = null;

  get isAcquired(): boolean {
    return this.stream !== null;
  }

  get isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined"
    );
  }

  // Acquire the mic once and keep it hot for the whole session. Idempotent.
  async acquire(): Promise<MicPermission> {
    if (this.stream) return "granted";
    if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
    }
    return "granted";
  }

  release(): void {
    this.clearMaxTurnTimer();
    this.discardRecorder();
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  // Start recording the current turn — call on button press. Delivers via
  // handlers.onResult once endTurn() (button release) or the runaway cap stops it.
  startTurn(handlers: CaptureHandlers): void {
    if (!this.stream) {
      handlers.onError("microphone not acquired");
      return;
    }

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
    } catch {
      handlers.onError("recorder init failed");
      return;
    }
    this.recorder = recorder;

    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      this.clearMaxTurnTimer();
      handlers.onResult(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" }));
    };

    try {
      recorder.start();
    } catch {
      handlers.onError("recorder start failed");
      return;
    }

    this.maxTurnTimer = setTimeout(() => this.safeStop(recorder), MAX_TURN_MS);
  }

  // Manual "release the button": stop recording now and deliver whatever was captured.
  endTurn(): void {
    if (this.recorder && this.recorder.state === "recording") {
      this.clearMaxTurnTimer();
      this.safeStop(this.recorder);
    }
  }

  // Discard the current turn without delivering — used for barge-in cleanup
  // and end-of-session. Keeps the held stream alive.
  abort(): void {
    this.clearMaxTurnTimer();
    this.discardRecorder();
  }

  private discardRecorder(): void {
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      if (this.recorder.state !== "inactive") this.safeStop(this.recorder);
      this.recorder = null;
    }
  }

  private safeStop(recorder: MediaRecorder): void {
    try {
      recorder.stop();
    } catch {
      /* already stopping/stopped */
    }
  }

  private clearMaxTurnTimer(): void {
    if (this.maxTurnTimer !== null) {
      clearTimeout(this.maxTurnTimer);
      this.maxTurnTimer = null;
    }
  }
}
