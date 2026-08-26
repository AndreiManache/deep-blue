// Client-side audio capture that replaces the browser's webkitSpeechRecognition.
// It holds ONE microphone stream open for the whole session (which keeps iOS in
// record mode, so a turn right after the AI speaks is never starved of audio —
// the bug that plagued the Web Speech API), records each turn with
// MediaRecorder, and decides when the turn is over with a simple volume-based
// VAD (voice-activity detector). The recorded blob goes to the server for
// transcription (ElevenLabs Scribe); there are no interim results.

export type MicPermission = "granted" | "denied" | "unavailable";

export interface CaptureHandlers {
  /** First moment speech is detected in this turn — the "did the mic get anything" signal. */
  onSpeechStart: () => void;
  /** The user finished a turn (trailing silence, hard cap, or manual stop): here's the audio. */
  onResult: (blob: Blob) => void;
  /** No speech at all within the window — treat as the user not responding. */
  onNoSpeech: () => void;
  onError: (message: string) => void;
}

// VAD tuning. RMS is on a 0..1 scale off the time-domain waveform.
const START_RMS = 0.025; // speech onset
const SILENCE_RMS = 0.018; // below this counts as quiet
const END_SILENCE_MS = 800; // trailing quiet after speech that ends the turn
const NO_SPEECH_MS = 8000; // nothing said at all -> onNoSpeech
const MAX_TURN_MS = 20000; // hard cap on one turn
const POLL_MS = 50;

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

function getAudioContextCtor(): typeof AudioContext | undefined {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return w.AudioContext ?? w.webkitAudioContext;
}

export class SpeechCapture {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private recorder: MediaRecorder | null = null;
  private vad: ReturnType<typeof setInterval> | null = null;

  get isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined" &&
      Boolean(getAudioContextCtor())
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
    const Ctor = getAudioContextCtor();
    if (!Ctor) return "unavailable";
    this.ctx = new Ctor();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    return "granted";
  }

  release(): void {
    this.stopVad();
    this.discardRecorder();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.analyser = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  // Listen for one turn. acquire() must have succeeded first.
  listen(handlers: CaptureHandlers): void {
    if (!this.stream || !this.analyser || !this.ctx) {
      handlers.onError("microphone not acquired");
      return;
    }
    // iOS suspends the context when it loses the audio focus to playback; a
    // resume (kicked off inside the tap chain) brings it back.
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});

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
    let aborted = false; // stop without delivering (no-speech / discard)
    let heard = false;
    let lastLoud = performance.now();
    const startedAt = performance.now();

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      this.stopVad();
      if (aborted) return;
      handlers.onResult(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/mp4" }));
    };

    const buf = new Uint8Array(this.analyser.fftSize);
    this.stopVad();
    this.vad = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = (buf[i] - 128) / 128;
        sum += x * x;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();

      if (rms > START_RMS) {
        if (!heard) {
          heard = true;
          handlers.onSpeechStart();
        }
        lastLoud = now;
      }

      if (!heard) {
        if (now - startedAt > NO_SPEECH_MS) {
          aborted = true;
          this.stopVad();
          this.safeStop(recorder);
          handlers.onNoSpeech();
        }
        return;
      }

      // Speech was heard: end the turn on trailing silence or the hard cap.
      if (rms < SILENCE_RMS && now - lastLoud > END_SILENCE_MS) {
        this.stopVad();
        this.safeStop(recorder); // -> onstop -> onResult
      } else if (now - startedAt > MAX_TURN_MS) {
        this.stopVad();
        this.safeStop(recorder);
      }
    }, POLL_MS);

    try {
      recorder.start();
    } catch {
      this.stopVad();
      handlers.onError("recorder start failed");
    }
  }

  // Manual "end my turn": deliver whatever's recorded (an empty/near-silent
  // clip just transcribes to nothing, which the caller handles).
  stopTurn(): void {
    if (this.recorder && this.recorder.state === "recording") {
      this.stopVad();
      this.safeStop(this.recorder);
    }
  }

  // Discard the current turn without delivering — before the AI speaks, and on
  // end-session. Keeps the held stream alive.
  abort(): void {
    this.stopVad();
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

  private stopVad(): void {
    if (this.vad) {
      clearInterval(this.vad);
      this.vad = null;
    }
  }
}
