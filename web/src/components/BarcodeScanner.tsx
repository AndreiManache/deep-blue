import { useEffect, useRef, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { ApiError, lookupBarcode, logBarcodeEntry, type BarcodeProduct } from "../api/client";

interface BarcodeScannerProps {
  onDone: () => void;
  /** Writes into the shared diagnostics log so a failure here is reportable. */
  log?: (label: string, detail?: string) => void;
}

type ScanState =
  | { kind: "requesting" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "scanning" }
  | { kind: "manual" }
  | { kind: "found"; barcode: string; product: BarcodeProduct }
  | { kind: "notfound" }
  | { kind: "saving"; barcode: string; grams: number }
  | { kind: "error"; message: string };

// After this long with no successful decode, tell the user scanning is still
// actively trying (not frozen) and suggest what to try — "point at a
// barcode" with zero further feedback reads as broken the moment it doesn't
// work on the first attempt.
const SLOW_SCAN_HINT_MS = 7000;
// If not even a single decode ATTEMPT (success or the expected per-frame
// "not found") has happened by this point, the scan loop itself never
// started or died silently — a real error, not just "no barcode yet".
const STUCK_LOOP_MS = 6000;
// How often we grab a frame and try to decode it. 200ms is well under
// zxing's own 500ms default and still cheap — barcode decoding on a single
// frame is fast, and more attempts per second means a faster lock-on.
const DECODE_INTERVAL_MS = 200;
// A usable camera frame is at least this many pixels on its long edge. Any
// real camera is 480p+, so this only ever catches a broken/degenerate track
// (0x0, or the 2x2 a dead stream can report) — never a legitimate one.
const MIN_USABLE_DIMENSION = 160;

function waitForVideoDimensions(video: HTMLVideoElement, timeoutMs = 4000): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      video.removeEventListener("loadedmetadata", check);
      resolve();
    };
    const check = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) finish();
    };
    video.addEventListener("loadedmetadata", check);
    // Belt-and-suspenders: on some browsers videoWidth lags loadedmetadata
    // for a live camera stream, so poll too rather than trust one event.
    const poll = setInterval(check, 50);
    setTimeout(finish, timeoutMs); // never block scanning forever on this
  });
}

// A live camera view is a different UI pattern from PhotoAttach's single-shot
// file picker — this decodes continuously from a video stream. @zxing/library
// is used unconditionally (no native BarcodeDetector path): the primary test
// device is an iPhone, where BarcodeDetector doesn't exist, so a native-first
// strategy would mean the fallback is the only path ever actually exercised.
export function BarcodeScanner({ onDone, log }: BarcodeScannerProps) {
  const [state, setState] = useState<ScanState>({ kind: "requesting" });
  const [grams, setGrams] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [slowHint, setSlowHint] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<import("@zxing/library").BrowserMultiFormatReader | null>(null);
  const decodedRef = useRef(false);
  const lastAttemptAtRef = useRef<number | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function releaseCamera() {
    if (loopRef.current) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    readerRef.current?.reset();
    readerRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        log?.("barcode: getUserMedia unavailable");
        setState({ kind: "unavailable" });
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        log?.("barcode: camera request failed", name || "unknown");
        setState(name === "NotAllowedError" || name === "SecurityError" ? { kind: "denied" } : { kind: "unavailable" });
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      // zxing sizes its internal capture canvas from videoWidth/videoHeight
      // on its very first decode attempt, then caches that size for the
      // whole session — if that first attempt races ahead of the camera
      // stream actually reporting real dimensions, every frame decodes
      // against a permanently-0x0 canvas: no error, no crash, it just
      // never finds anything, forever.
      await waitForVideoDimensions(video);
      if (cancelled) return;
      if (Math.max(video.videoWidth, video.videoHeight) < MIN_USABLE_DIMENSION) {
        // Either dimensions never arrived (0x0) or the track is degenerate.
        // Decoding such a frame can only ever fail, so say so rather than
        // sitting on "still looking" forever — the exact failure mode we're
        // fixing. Threshold is far below any real camera, so a legitimate
        // stream can never trip it.
        log?.("barcode: unusable video size", `${video.videoWidth}x${video.videoHeight}`);
        setState({
          kind: "error",
          message: "The camera didn't start properly. Try again, or type the barcode in instead.",
        });
        return;
      }

      const zxing = await import("@zxing/library");
      if (cancelled) return;
      const reader = new zxing.BrowserMultiFormatReader();
      readerRef.current = reader;
      decodedRef.current = false;
      lastAttemptAtRef.current = Date.now();
      setState({ kind: "scanning" });
      setSlowHint(false);
      log?.("barcode: scan loop started", `${video.videoWidth}x${video.videoHeight}`);

      // We drive the decode loop ourselves instead of using zxing's
      // decodeFromVideoElementContinuously. That helper first awaits an
      // internal playVideoOnLoadAsync, which resolves only on the video's
      // `playing` EVENT — but it attaches that listener and then skips
      // calling play() when the video is already playing ("Trying to play
      // video that is already playing"). Since we start playback ourselves
      // (and now also wait for dimensions before getting here), the video is
      // ALWAYS already playing at that point, so `playing` never fires again,
      // the promise never resolves, and the decode loop is never started at
      // all — no frames, no errors, nothing. Owning the loop sidesteps that
      // lifecycle entirely and makes every frame's outcome observable.
      loopRef.current = setInterval(() => {
        if (cancelled || decodedRef.current || !videoRef.current) return;
        lastAttemptAtRef.current = Date.now();
        let result;
        try {
          result = reader.decode(videoRef.current);
        } catch (err) {
          // A miss on any given frame is the overwhelmingly common case and
          // is not an error worth surfacing; anything else is.
          const expected =
            err instanceof zxing.NotFoundException ||
            err instanceof zxing.ChecksumException ||
            err instanceof zxing.FormatException;
          if (!expected) {
            log?.("barcode: decode error", err instanceof Error ? err.message : String(err));
          }
          return;
        }
        decodedRef.current = true;
        const barcode = result.getText();
        log?.("barcode: decoded", barcode);
        releaseCamera();
        void handleDecoded(barcode);
      }, DECODE_INTERVAL_MS);
    }

    async function handleDecoded(barcode: string) {
      try {
        const product = await lookupBarcode(barcode);
        if (cancelled) return;
        setState(product ? { kind: "found", barcode, product } : { kind: "notfound" });
      } catch (err) {
        if (cancelled) return;
        setState({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
      }
    }

    void start();
    return () => {
      cancelled = true;
      releaseCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Two independent timers while scanning: a friendly "still looking" hint,
  // and a watchdog that surfaces a real error if the decode loop appears to
  // have genuinely stopped running (as opposed to just not finding a match
  // yet, which fires constantly and is expected).
  useEffect(() => {
    if (state.kind !== "scanning") return;
    const hintTimer = setTimeout(() => setSlowHint(true), SLOW_SCAN_HINT_MS);
    const watchdog = setInterval(() => {
      const last = lastAttemptAtRef.current;
      if (last != null && Date.now() - last > STUCK_LOOP_MS) {
        log?.("barcode: scan loop stalled", `${Math.round((Date.now() - last) / 1000)}s since last attempt`);
        setState({
          kind: "error",
          message: "Scanning got stuck. Try again, or type the barcode in instead.",
        });
      }
    }, 1000);
    return () => {
      clearTimeout(hintTimer);
      clearInterval(watchdog);
    };
  }, [state.kind]);

  async function handleManualLookup() {
    const code = manualCode.trim();
    if (!/^\d{8,14}$/.test(code) || manualBusy) return;
    setManualBusy(true);
    try {
      const product = await lookupBarcode(code);
      setState(product ? { kind: "found", barcode: code, product } : { kind: "notfound" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setManualBusy(false);
    }
  }

  async function handleLog() {
    if (state.kind !== "found") return;
    const g = Number(grams);
    if (!Number.isFinite(g) || g <= 0) return;
    setState({ kind: "saving", barcode: state.barcode, grams: g });
    try {
      await logBarcodeEntry(state.barcode, g);
      onDone();
    } catch (err) {
      setState({ kind: "error", message: err instanceof ApiError ? err.message : "Could not log this item." });
    }
  }

  const g = Number(grams);
  const previewCalories =
    state.kind === "found" && Number.isFinite(g) && g > 0
      ? Math.round((state.product.nutrition.calories * g) / 100)
      : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      {(state.kind === "requesting" || state.kind === "scanning") && (
        <>
          <video ref={videoRef} className="size-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-40 w-64 rounded-2xl border-2 border-cream/70" />
          </div>
          <div className="absolute inset-x-0 top-16 flex flex-col items-center gap-2 px-6 text-center">
            <p className="text-sm font-bold text-cream/80">
              {state.kind === "requesting"
                ? "Starting camera…"
                : slowHint
                  ? "Still looking — try moving closer, holding steady, or better light."
                  : "Point at a barcode"}
            </p>
            {state.kind === "scanning" && (
              <button
                className="flex items-center gap-1.5 rounded-full bg-cream/10 px-3 py-1.5 text-xs font-bold text-cream/70 backdrop-blur transition-colors hover:bg-cream/20"
                onClick={() => setState({ kind: "manual" })}
              >
                <Keyboard className="size-3.5" />
                Type it in instead
              </button>
            )}
          </div>
        </>
      )}

      {state.kind === "manual" && (
        <div className="flex flex-1 flex-col justify-end p-6">
          <div className="rounded-[2rem] bg-white p-6 shadow-xl">
            <p className="font-display text-xl font-extrabold tracking-tight text-ink">
              Enter the barcode
            </p>
            <p className="mt-1 text-sm font-medium text-ink/50">
              The digits printed under the barcode's lines, 8 to 14 of them.
            </p>
            <input
              autoFocus
              inputMode="numeric"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 5901234123457"
              disabled={manualBusy}
              className="mt-4 w-full rounded-xl bg-ink3 px-4 py-3 text-lg font-bold text-ink outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50"
            />
            <div className="mt-5 flex gap-2">
              <button
                className="flex-1 rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98] disabled:opacity-60"
                onClick={handleManualLookup}
                disabled={manualBusy || !/^\d{8,14}$/.test(manualCode.trim())}
              >
                {manualBusy ? "Looking up…" : "Look it up"}
              </button>
              <button
                className="rounded-2xl bg-white px-5 py-4 text-sm font-bold text-ink ring-1 ring-ink/10 transition-colors hover:bg-ink3"
                onClick={() => setState({ kind: "scanning" })}
                disabled={manualBusy}
              >
                Back to camera
              </button>
            </div>
          </div>
        </div>
      )}

      {state.kind === "denied" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-display text-xl font-extrabold text-cream">Camera access is blocked</p>
          <p className="text-sm font-medium text-cream/60">
            Deep Blue needs the camera to scan a barcode. Allow it in your browser's site settings,
            then try again — or type the barcode's digits in by hand.
          </p>
          <button
            className="mt-2 w-full max-w-xs rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
            onClick={() => setState({ kind: "manual" })}
          >
            Type the barcode in
          </button>
          <button
            className="w-full max-w-xs rounded-2xl bg-white/10 py-4 text-sm font-bold text-cream transition-colors hover:bg-white/20"
            onClick={onDone}
          >
            Back to Deep Blue
          </button>
        </div>
      )}

      {state.kind === "unavailable" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-display text-xl font-extrabold text-cream">Camera isn't available</p>
          <p className="text-sm font-medium text-cream/60">
            Try the latest Safari (iOS) or Chrome — or type the barcode's digits in by hand.
          </p>
          <button
            className="mt-2 w-full max-w-xs rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
            onClick={() => setState({ kind: "manual" })}
          >
            Type the barcode in
          </button>
          <button
            className="w-full max-w-xs rounded-2xl bg-white/10 py-4 text-sm font-bold text-cream transition-colors hover:bg-white/20"
            onClick={onDone}
          >
            Back to Deep Blue
          </button>
        </div>
      )}

      {state.kind === "notfound" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-display text-xl font-extrabold text-cream">Didn't find that product</p>
          <p className="text-sm font-medium text-cream/60">
            Tap the orb and describe it instead — that works for anything not in the barcode database.
          </p>
          <button
            className="mt-2 w-full max-w-xs rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
            onClick={onDone}
          >
            Back to Deep Blue
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-display text-xl font-extrabold text-cream">Something went wrong</p>
          <p className="text-sm font-medium text-cream/60">{state.message}</p>
          <button
            className="mt-2 w-full max-w-xs rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
            onClick={() => setState({ kind: "manual" })}
          >
            Type the barcode in
          </button>
          <button
            className="w-full max-w-xs rounded-2xl bg-white/10 py-4 text-sm font-bold text-cream transition-colors hover:bg-white/20"
            onClick={onDone}
          >
            Back to Deep Blue
          </button>
        </div>
      )}

      {(state.kind === "found" || state.kind === "saving") && (
        <div className="flex flex-1 flex-col justify-end p-6">
          <div className="rounded-[2rem] bg-white p-6 shadow-xl">
            <p className="font-display text-xl font-extrabold tracking-tight text-ink">
              {state.kind === "found" ? state.product.name : "Logging…"}
            </p>
            {state.kind === "found" && state.product.brand && (
              <p className="text-sm font-medium text-ink/50">{state.product.brand}</p>
            )}
            <p className="mt-1 text-xs font-semibold text-ink/40">
              {(state.kind === "found" ? state.product : null)?.nutrition.calories} kcal / 100g
            </p>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-ink/40">
              Grams eaten
            </label>
            <input
              autoFocus
              inputMode="decimal"
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
              placeholder="e.g. 250"
              disabled={state.kind === "saving"}
              className="mt-1 w-full rounded-xl bg-ink3 px-4 py-3 text-lg font-bold text-ink outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50"
            />
            {previewCalories != null && (
              <p className="mt-2 text-sm font-semibold text-ink/60">≈ {previewCalories} kcal</p>
            )}

            <button
              className="mt-5 w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98] disabled:opacity-60"
              onClick={handleLog}
              disabled={state.kind === "saving" || !(Number.isFinite(g) && g > 0)}
            >
              {state.kind === "saving" ? "Logging…" : "Log it"}
            </button>
          </div>
        </div>
      )}

      <button
        className="fixed right-5 top-5 z-50 grid size-11 place-items-center rounded-full bg-ink/60 text-cream backdrop-blur transition-colors hover:bg-ink/80"
        onClick={onDone}
        aria-label="Close scanner"
      >
        <X className="size-5" />
      </button>
    </div>
  );
}
