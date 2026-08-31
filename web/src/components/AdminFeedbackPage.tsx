import { useEffect, useState } from "react";
import { Check, ChevronDown, Clipboard, ClipboardCheck, Mic, Sparkles, Trash2 } from "lucide-react";
import {
  ApiError,
  deleteFeedbackItem,
  fetchAdminFeedback,
  setFeedbackResolutionNote,
  setFeedbackStatus,
  summarizeFeedback,
  transcribeFeedback,
  type FeedbackItem,
} from "../api/client";
import { BackHeader } from "./BackHeader";
import { cn } from "../lib/utils";

interface AdminFeedbackPageProps {
  onBack: () => void;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLog(raw: string): string {
  try {
    const events = JSON.parse(raw) as { t: number; label: string; detail?: string }[];
    return events
      .map((e) => `${new Date(e.t).toLocaleTimeString(undefined, { hour12: false })}  ${e.label}${e.detail ? `: ${e.detail}` : ""}`)
      .join("\n");
  } catch {
    return raw;
  }
}

// Everything about a report, in one paste-able block — this is the "give
// Claude access to a specific entry" answer: copy this and paste it into
// chat, no need to describe what's in the audio or dig up the log yourself.
function buildClaudeBlob(item: FeedbackItem): string {
  const lines = [
    `Feedback from ${item.username}, ${fmtTime(item.created_at)}`,
    item.message ? `\nMessage:\n${item.message}` : null,
    item.transcript ? `\nVoice note (transcribed):\n${item.transcript}` : item.audio_base64
      ? "\nVoice note: attached, not yet transcribed — transcribe it first."
      : null,
    item.log_snapshot ? `\nDiagnostics log:\n${formatLog(item.log_snapshot)}` : null,
    item.image_base64 ? "\nPhoto: attached — see the report in the admin inbox to view it." : null,
  ].filter((l): l is string => l != null);
  return lines.join("\n");
}

export function AdminFeedbackPage({ onBack }: AdminFeedbackPageProps) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default — a completed report is done, not something that
  // needs to keep taking up room in the inbox you triage every day.
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    fetchAdminFeedback()
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load feedback."))
      .finally(() => setLoading(false));
  }, []);

  // Cycles new -> reviewed -> completed -> new. 'completed' is the explicit
  // "fixed, tell the reporter" signal — it's what moves the report into
  // their collapsed "Fixed issues" section (see MyFeedbackPage.tsx).
  async function toggleStatus(item: FeedbackItem) {
    const next = item.status === "new" ? "reviewed" : item.status === "reviewed" ? "completed" : "new";
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: next } : i)));
    try {
      await setFeedbackStatus(item.id, next);
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: item.status } : i)));
    }
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await deleteFeedbackItem(id);
    } catch {
      /* item is gone from the list; a failed delete just means it'll still be there on next load */
    }
  }

  function handleTranscribed(id: string, transcript: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, transcript } : i)));
  }

  function handleNoteSaved(id: string, note: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, resolution_note: note } : i)));
  }

  function handleSummarized(id: string, title: string, summary: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, title, summary } : i)));
  }

  const active = items.filter((item) => item.status !== "completed");
  const archived = items.filter((item) => item.status === "completed");

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title="Feedback inbox" subtitle={`${active.length} report${active.length === 1 ? "" : "s"}`} onBack={onBack} />

      {loading && <p className="py-10 text-center text-sm font-medium text-ink/40">Loading…</p>}
      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">No feedback yet.</p>
      )}

      {active.length > 0 && (
        <div className="space-y-3">
          {active.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              onToggleStatus={() => toggleStatus(item)}
              onDelete={() => handleDelete(item.id)}
              onTranscribed={(text) => handleTranscribed(item.id, text)}
              onNoteSaved={(note) => handleNoteSaved(item.id, note)}
              onSummarized={(title, summary) => handleSummarized(item.id, title, summary)}
            />
          ))}
        </div>
      )}

      {!loading && !error && active.length === 0 && archived.length > 0 && (
        <p className="py-10 text-center text-sm font-medium text-ink/40">
          Nothing to triage — everything's archived below.
        </p>
      )}

      {archived.length > 0 && (
        <div className="border-t border-ink/10 pt-4">
          <button
            className="flex w-full items-center justify-between text-left"
            onClick={() => setShowArchived((s) => !s)}
            aria-expanded={showArchived}
          >
            <span className="text-sm font-bold text-ink/50">Archived ({archived.length})</span>
            <ChevronDown className={cn("size-4 text-ink/40 transition-transform", showArchived && "rotate-180")} />
          </button>
          {showArchived && (
            <div className="mt-3 space-y-3">
              {archived.map((item) => (
                <FeedbackCard
                  key={item.id}
                  item={item}
                  onToggleStatus={() => toggleStatus(item)}
                  onDelete={() => handleDelete(item.id)}
                  onTranscribed={(text) => handleTranscribed(item.id, text)}
                  onNoteSaved={(note) => handleNoteSaved(item.id, note)}
                  onSummarized={(title, summary) => handleSummarized(item.id, title, summary)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface FeedbackCardProps {
  item: FeedbackItem;
  onToggleStatus: () => void;
  onDelete: () => void;
  onTranscribed: (transcript: string) => void;
  onNoteSaved: (note: string) => void;
  onSummarized: (title: string, summary: string) => void;
}

function FeedbackCard({ item, onToggleStatus, onDelete, onTranscribed, onNoteSaved, onSummarized }: FeedbackCardProps) {
  const [expandedLog, setExpandedLog] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summarizeError, setSummarizeError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Local draft — only pushed to the server (and up to the parent) on Save,
  // so typing doesn't refetch/rerender the whole list on every keystroke.
  const [noteDraft, setNoteDraft] = useState(item.resolution_note ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function handleSummarize() {
    if (summarizing) return;
    setSummarizing(true);
    setSummarizeError(null);
    try {
      const result = await summarizeFeedback(item.id);
      onSummarized(result.title, result.summary);
    } catch (err) {
      setSummarizeError(err instanceof ApiError ? err.message : "Could not generate a title.");
    } finally {
      setSummarizing(false);
    }
  }

  async function handleTranscribe() {
    if (transcribing) return;
    setTranscribing(true);
    setTranscribeError(null);
    try {
      const text = await transcribeFeedback(item.id);
      onTranscribed(text);
      // One click gets both — no reason to make transcribing and titling
      // two separate button presses when a transcript is what unblocks the
      // title in the first place. A failure here is silent by design: the
      // transcript itself already succeeded and is the thing that mattered.
      void handleSummarize();
    } catch (err) {
      setTranscribeError(err instanceof ApiError ? err.message : "Could not transcribe this voice note.");
    } finally {
      setTranscribing(false);
    }
  }

  async function handleSaveNote() {
    if (savingNote) return;
    setSavingNote(true);
    setNoteError(null);
    try {
      await setFeedbackResolutionNote(item.id, noteDraft.trim() || null);
      onNoteSaved(noteDraft.trim());
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 1500);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : "Could not save the note.");
    } finally {
      setSavingNote(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(buildClaudeBlob(item));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing else to fall back to here */
    }
  }

  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          {item.title ? (
            <>
              <div className="font-display text-sm font-extrabold tracking-tight text-ink">{item.title}</div>
              <div className="text-xs font-semibold text-ink/40">
                {item.username} · {fmtTime(item.created_at)}
              </div>
            </>
          ) : (
            <>
              <div className="font-display text-sm font-extrabold tracking-tight text-ink">{item.username}</div>
              <div className="text-xs font-semibold text-ink/40">{fmtTime(item.created_at)}</div>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className={cn(
              "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors",
              item.status === "new"
                ? "bg-coral/10 text-coral hover:bg-coral/20"
                : item.status === "completed"
                  ? "bg-leaf/15 text-leaf hover:bg-leaf/25"
                  : "bg-ink3 text-ink/40 hover:bg-ink/10",
            )}
            onClick={onToggleStatus}
          >
            {item.status === "new" ? "New" : item.status === "completed" ? "Completed" : "Reviewed"}
          </button>
          <button
            className="grid size-8 place-items-center rounded-full text-ink/40 transition-colors hover:bg-coral/10 hover:text-coral"
            onClick={handleCopy}
            aria-label="Copy everything for Claude"
            title="Copy everything for Claude"
          >
            {copied ? <ClipboardCheck className="size-4 text-coral" /> : <Clipboard className="size-4" />}
          </button>
          <button
            className={cn(
              "grid h-8 place-items-center rounded-full transition-colors",
              confirmingDelete ? "w-auto bg-coral px-2.5 text-white" : "w-8 text-coral/50 hover:bg-coral/10 hover:text-coral",
            )}
            onClick={() => (confirmingDelete ? onDelete() : setConfirmingDelete(true))}
            aria-label={confirmingDelete ? "Confirm delete" : "Delete report"}
          >
            {confirmingDelete ? <span className="text-[11px] font-bold">Sure?</span> : <Trash2 className="size-4" />}
          </button>
        </div>
      </div>

      {item.summary && (
        <p className="mt-3 rounded-xl bg-sky/10 px-3 py-2 text-xs font-semibold leading-relaxed text-ink/60">
          {item.summary}
        </p>
      )}

      {item.message && (
        <p className="mt-3 text-sm font-medium leading-relaxed text-ink/80">{item.message}</p>
      )}

      {item.image_base64 && (
        <img
          src={`data:${item.image_mime ?? "image/jpeg"};base64,${item.image_base64}`}
          alt="Attached to this report"
          className="mt-3 max-h-64 w-full rounded-xl object-contain bg-ink3"
        />
      )}

      {!item.title && (item.message || item.transcript) && (
        <button
          className="mt-3 flex items-center gap-1.5 text-xs font-bold text-ink/40 transition-colors hover:text-ink/70"
          onClick={handleSummarize}
          disabled={summarizing}
        >
          <Sparkles className="size-3.5" />
          {summarizing ? "Generating…" : "Generate title"}
        </button>
      )}
      {summarizeError && <p className="mt-1 text-xs font-semibold text-coral">{summarizeError}</p>}

      {item.audio_base64 && (
        <div className="mt-3 space-y-2">
          <audio
            className="h-8 w-full"
            controls
            src={`data:${item.audio_mime ?? "audio/mp4"};base64,${item.audio_base64}`}
          />
          {item.transcript ? (
            <p className="rounded-xl bg-ink3 px-3 py-2.5 text-sm font-medium leading-relaxed text-ink/70">
              {item.transcript}
            </p>
          ) : (
            <button
              className="flex items-center gap-1.5 text-xs font-bold text-ink/40 transition-colors hover:text-ink/70"
              onClick={handleTranscribe}
              disabled={transcribing}
            >
              <Mic className="size-3.5" />
              {transcribing ? "Transcribing…" : "Transcribe voice note"}
            </button>
          )}
          {transcribeError && <p className="text-xs font-semibold text-coral">{transcribeError}</p>}
        </div>
      )}

      {item.log_snapshot && (
        <div className="mt-3">
          <button
            className="text-xs font-bold text-ink/40 underline underline-offset-2 hover:text-ink/70"
            onClick={() => setExpandedLog((e) => !e)}
          >
            {expandedLog ? "Hide diagnostics log" : "Show diagnostics log"}
          </button>
          {expandedLog && (
            <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-ink p-3 font-mono text-[11px] leading-relaxed text-white/70">
              {formatLog(item.log_snapshot)}
            </pre>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-ink/5 pt-3">
        <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-ink/40">
          Note back to {item.username} — shown on their "My feedback" screen
        </label>
        <textarea
          className="min-h-16 w-full resize-y rounded-xl bg-ink3 px-3 py-2.5 text-sm font-medium text-ink outline-none placeholder:text-ink/35 focus:ring-2 focus:ring-coral/50"
          placeholder="e.g. “Fixed — should work now, let me know if not.”"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-bold text-cream transition-colors hover:bg-ink/80 disabled:opacity-50"
            onClick={handleSaveNote}
            disabled={savingNote || noteDraft.trim() === (item.resolution_note ?? "")}
          >
            {noteSaved ? <Check className="size-3.5" /> : null}
            {savingNote ? "Saving…" : noteSaved ? "Saved" : "Save note"}
          </button>
          {noteError && <p className="text-xs font-semibold text-coral">{noteError}</p>}
        </div>
      </div>
    </div>
  );
}
