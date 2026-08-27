import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ApiError, lookupBarcode, logBarcodeEntry, type BarcodeProduct } from "../api/client";
import { MicPermissionHelp } from "./MicPermissionHelp";

interface BarcodeScannerProps {
  onDone: () => void;
}

type ScanState =
  | { kind: "requesting" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "scanning" }
  | { kind: "found"; barcode: string; product: BarcodeProduct }
  | { kind: "notfound" }
  | { kind: "saving"; barcode: string; grams: number }
  | { kind: "error"; message: string };

// A live camera view is a different UI pattern from PhotoAttach's single-shot
// file picker — this decodes continuously from a video stream. @zxing/library
// is used unconditionally (no native BarcodeDetector path): the primary test
// device is an iPhone, where BarcodeDetector doesn't exist, so a native-first
// strategy would mean the fallback is the only path ever actually exercised.
export function BarcodeScanner({ onDone }: BarcodeScannerProps) {
  const [state, setState] = useState<ScanState>({ kind: "requesting" });
  const [grams, setGrams] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const readerRef = useRef<import("@zxing/library").BrowserMultiFormatReader | null>(null);
  const decodedRef = useRef(false);

  function releaseCamera() {
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
        setState({ kind: "unavailable" });
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof Error ? err.name : "";
        setState(name === "NotAllowedError" || name === "SecurityError" ? { kind: "denied" } : { kind: "unavailable" });
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const { BrowserMultiFormatReader } = await import("@zxing/library");
      if (cancelled) return;
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;
      decodedRef.current = false;
      setState({ kind: "scanning" });

      if (!videoRef.current) return;
      // The type declares `result` as non-nullable, but the library actually
      // calls back as (result, null) on a hit or (null, error) on every miss
      // frame — NotFoundException fires continuously between frames, expected.
      void reader.decodeFromVideoElementContinuously(videoRef.current, (result) => {
        if (decodedRef.current || cancelled || !result) return;
        decodedRef.current = true;
        const barcode = result.getText();
        releaseCamera();
        void handleDecoded(barcode);
      });
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
          <p className="absolute inset-x-0 top-16 text-center text-sm font-bold text-cream/80">
            {state.kind === "requesting" ? "Starting camera…" : "Point at a barcode"}
          </p>
        </>
      )}

      {state.kind === "denied" && (
        <div className="flex flex-1 items-center px-6">
          <MicPermissionHelp onRetry={onDone} />
        </div>
      )}

      {state.kind === "unavailable" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-display text-xl font-extrabold text-cream">Camera isn't available</p>
          <p className="text-sm font-medium text-cream/60">
            Try the latest Safari (iOS) or Chrome, or log this one by voice instead.
          </p>
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
