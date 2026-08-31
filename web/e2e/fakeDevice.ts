import type { Page } from "@playwright/test";

// Fakes getUserMedia/AudioContext/MediaRecorder realistically enough to drive
// SpeechCapture's (src/speech/capture.ts) actual state machine — not just
// stubbed to unblock rendering. Installed via addInitScript, so it's in
// place before the app's own scripts run and probe for support
// (getSpeechSupport()).
//
// Controllable from the test via page.evaluate(() => window.__fakeAudio...):
//   - setRms(value): drives the fake AnalyserNode's output. SpeechCapture's
//     VAD polls this every 50ms — a constant buffer value v maps to
//     RMS = |(v-128)/128|, so setRms(x) makes every sample read that exact x.
//   - getEvents()/clearEvents(): an ordered log of every fake-device call
//     (getUserMedia, recorder construct/start/stop) — used to assert
//     ordering guarantees like "permission before any recording starts".
//
// This function's BODY runs inside the browser page, not in Node — it must
// be fully self-contained (no closures over outer scope) since Playwright
// serializes it to a string.
function installFakeAudioDeviceInPage(): void {
  interface FakeAudioGlobal {
    setRms: (v: number) => void;
    getEvents: () => { name: string; t: number }[];
    clearEvents: () => void;
  }
  const state = { rms: 0, events: [] as { name: string; t: number }[] };

  function log(name: string): void {
    state.events.push({ name, t: Date.now() });
  }

  (window as unknown as { __fakeAudio: FakeAudioGlobal }).__fakeAudio = {
    setRms(v: number) {
      state.rms = v;
    },
    getEvents() {
      return state.events.slice();
    },
    clearEvents() {
      state.events.length = 0;
    },
  };

  class FakeTrack {
    stop(): void {
      log("track-stop");
    }
  }
  class FakeStream {
    private tracks = [new FakeTrack()];
    getTracks() {
      return this.tracks;
    }
  }

  const md = (navigator as unknown as { mediaDevices: MediaDevices }).mediaDevices ?? {};
  (md as unknown as { getUserMedia: () => Promise<unknown> }).getUserMedia = async () => {
    log("getUserMedia-called");
    const stream = new FakeStream();
    log("getUserMedia-resolved");
    return stream;
  };
  (navigator as unknown as { mediaDevices: unknown }).mediaDevices = md;

  class FakeAnalyserNode {
    fftSize = 2048;
    getByteTimeDomainData(buf: Uint8Array): void {
      const v = Math.max(0, Math.min(255, Math.round(128 + state.rms * 128)));
      buf.fill(v);
    }
  }
  class FakeAudioContext {
    state = "running";
    createMediaStreamSource(_stream: unknown) {
      return { connect() {} };
    }
    createAnalyser() {
      return new FakeAnalyserNode();
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext = FakeAudioContext;

  class FakeMediaRecorder {
    state = "inactive";
    mimeType: string;
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor(_stream: unknown, options?: { mimeType?: string }) {
      this.mimeType = options?.mimeType ?? "audio/webm";
      log("recorder-constructed");
    }
    static isTypeSupported(_type: string): boolean {
      return true;
    }
    start(): void {
      this.state = "recording";
      log("recorder-start");
    }
    stop(): void {
      if (this.state === "inactive") return;
      this.state = "inactive";
      log("recorder-stop");
      // Deferred, matching the real MediaRecorder firing its events on a
      // later turn of the event loop rather than synchronously.
      setTimeout(() => {
        this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: this.mimeType }) });
        this.onstop?.();
      }, 0);
    }
  }
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
}

export async function installFakeAudioDevice(page: Page): Promise<void> {
  await page.addInitScript(installFakeAudioDeviceInPage);
}

export async function setFakeRms(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => (window as unknown as { __fakeAudio: { setRms: (n: number) => void } }).__fakeAudio.setRms(v), value);
}

export async function getFakeAudioEvents(page: Page): Promise<{ name: string; t: number }[]> {
  return page.evaluate(
    () => (window as unknown as { __fakeAudio: { getEvents: () => { name: string; t: number }[] } }).__fakeAudio.getEvents(),
  );
}
