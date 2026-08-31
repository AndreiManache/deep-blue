import { useRef, useState } from "react";
import { Image as ImageIcon, Mic, Square, Trash2, X } from "lucide-react";
import { ApiError, submitFeedback, type ImageAttachment } from "../api/client";
import type { DiagEvent } from "../conversation/useConversation";
import { resizeToJpeg } from "../lib/resizeImage";
import { BackHeader } from "./BackHeader";
import { MyFeedbackList } from "./MyFeedbackList";
import { cn } from "../lib/utils";

interface FeedbackPageProps {
  diagnostics: DiagEvent[];
  onBack: () => void;
}

function pickMimeType(): string {
  const prefs = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const t of prefs) {
    try {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some engines — treat as unsupported */
    }
  }
  return ""; // let the engine choose
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function FeedbackPage({ diagnostics, onBack }: FeedbackPageProps) {
  // Two tabs instead of two separate menu items/pages (2026-08-31, "we
  // don't want two separate items in the main menu about feedback") — the
  // submit form and the reporter's own report history now live on one page.
  const [tab, setTab] = useState<"send" | "history">("send");
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [image, setImage] = useState<ImageAttachment | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [includeLog, setIncludeLog] = useState(diagnostics.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Deliberately no `capture` attribute (unlike PhotoAttach.tsx) — this is
  // for an already-taken photo from the library/files, not a live camera
  // shot (2026-08-30, requested explicitly as a distinct flow).
  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImageError(null);
    try {
      setImage(await resizeToJpeg(file));
    } catch {
      setImageError("Couldn't read that photo — try again.");
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/mp4" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Couldn't access the microphone. You can still type your feedback.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  function discardRecording() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
  }

  async function handleSubmit() {
    if (busy) return;
    if (!message.trim() && !audioBlob && !image) {
      setError("Add a message, a voice note, or a photo first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const audio_base64 = audioBlob ? await blobToBase64(audioBlob) : null;
      await submitFeedback({
        message: message.trim() || null,
        audio_base64,
        audio_mime: audioBlob?.type ?? null,
        log_snapshot: includeLog && diagnostics.length > 0 ? JSON.stringify(diagnostics) : null,
        image_base64: image?.base64 ?? null,
        image_mime: image?.mime ?? null,
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send feedback. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setMessage("");
    setAudioBlob(null);
    setAudioUrl(null);
    setImage(null);
    setImageError(null);
    setError(null);
    setSent(false);
  }

  if (sent) {
    return (
      <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
        <BackHeader title="Feedback" subtitle="Bugs and ideas, straight to Andrei" onBack={onBack} />
        <div className="rounded-[2rem] bg-white p-7 text-center shadow-sm ring-1 ring-ink/5">
          <div className="font-display text-2xl font-extrabold tracking-tight text-ink">
            Thanks — got it!
          </div>
          <p className="mt-2 text-sm font-medium text-ink/60">
            Your report was sent. Feel free to send another whenever something comes up.
          </p>
          <button
            className="mt-6 w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98]"
            onClick={resetForm}
          >
            Send another
          </button>
          <button
            className="mt-3 w-full rounded-2xl bg-ink3 py-4 text-sm font-bold text-ink/70 transition-colors hover:bg-ink/10"
            onClick={onBack}
          >
            Back to Deep Blue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="Feedback" subtitle="Bugs and ideas, straight to Andrei" onBack={onBack} />

      <div className="flex gap-2 rounded-2xl bg-ink3 p-1">
        <button
          className={cn(
            "flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors",
            tab === "send" ? "bg-white text-ink shadow-sm" : "text-ink/50",
          )}
          onClick={() => setTab("send")}
        >
          Send feedback
        </button>
        <button
          className={cn(
            "flex-1 rounded-xl py-2.5 text-sm font-bold transition-colors",
            tab === "history" ? "bg-white text-ink shadow-sm" : "text-ink/50",
          )}
          onClick={() => setTab("history")}
        >
          My reports
        </button>
      </div>

      {tab === "history" && <MyFeedbackList />}

      {tab === "send" && (
      <div className="space-y-4 rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
        <textarea
          className="min-h-32 w-full resize-y rounded-xl bg-ink3 px-4 py-3 text-sm font-medium text-ink outline-none placeholder:text-ink/35 focus:ring-2 focus:ring-coral/50"
          placeholder="What did you notice? A bug, something confusing, or an idea — as much or as little detail as you like."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />

        <div>
          {audioUrl ? (
            <div className="flex items-center gap-3 rounded-xl bg-ink3 px-4 py-3">
              <audio className="h-8 flex-1" controls src={audioUrl} />
              <button
                className="grid size-9 shrink-0 place-items-center rounded-lg text-coral/70 transition-colors hover:bg-coral/10 hover:text-coral"
                onClick={discardRecording}
                aria-label="Discard recording"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ) : (
            <button
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-colors",
                recording ? "bg-coral text-white" : "bg-ink3 text-ink/70 hover:bg-ink/10",
              )}
              onClick={recording ? stopRecording : startRecording}
            >
              {recording ? (
                <>
                  <Square className="size-4" /> Stop recording
                </>
              ) : (
                <>
                  <Mic className="size-4" /> Record a voice note
                </>
              )}
            </button>
          )}
        </div>

        <div>
          {image ? (
            <div className="flex items-center gap-3 rounded-xl bg-ink3 px-4 py-3">
              <img
                src={`data:${image.mime};base64,${image.base64}`}
                alt="Attached photo"
                className="size-12 shrink-0 rounded-lg object-cover"
              />
              <span className="flex-1 text-sm font-semibold text-ink/60">Photo attached</span>
              <button
                className="grid size-9 shrink-0 place-items-center rounded-lg text-coral/70 transition-colors hover:bg-coral/10 hover:text-coral"
                onClick={() => setImage(null)}
                aria-label="Remove photo"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink3 py-3 text-sm font-bold text-ink/70 transition-colors hover:bg-ink/10"
              onClick={() => imageInputRef.current?.click()}
            >
              <ImageIcon className="size-4" /> Attach a photo
            </button>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageFile}
          />
          {imageError && <p className="mt-1.5 text-xs font-semibold text-coral">{imageError}</p>}
        </div>

        {diagnostics.length > 0 && (
          <label className="flex items-center gap-3 text-sm font-semibold text-ink/70">
            <input
              type="checkbox"
              className="size-4 accent-coral"
              checked={includeLog}
              onChange={(e) => setIncludeLog(e.target.checked)}
            />
            Include this session's diagnostics log ({diagnostics.length} events)
          </label>
        )}

        {error && (
          <p className="rounded-xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral">{error}</p>
        )}

        <button
          className="w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98] disabled:opacity-60"
          onClick={handleSubmit}
          disabled={busy}
        >
          {busy ? "Sending…" : "Send feedback"}
        </button>
      </div>
      )}
    </div>
  );
}
