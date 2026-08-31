import {
  getFeedbackAudio,
  getFeedbackMeta,
  getFeedbackText,
  listFeedbackIdsNeedingTitle,
  setFeedbackTitleSummary,
  setFeedbackTranscript,
} from "./feedback.js";
import { summarizeFeedback } from "./feedbackSummary.js";
import { transcribeFeedbackAudio } from "./sttProvider.js";

// Automatically gives every feedback report an AI-generated title + short
// description (2026-08-31, requested explicitly — supersedes the earlier
// admin-manual "Generate title" button, which stays as a re-run override).
//
// The title/summary come from the report's own text: the typed message for a
// written report, or — for a voice note — its transcript, which we produce
// first (the same ElevenLabs Scribe path the admin "Transcribe" button uses
// — see transcribeFeedbackAudio in sttProvider.ts for why feedback always
// uses Scribe directly instead of the live-conversation STT split). Runs in
// the background so submitting feedback stays instant, and is idempotent: a
// report that already has a title is skipped, so this is safe to call
// repeatedly.

// Make one report's title/summary exist. No-op if it already has a title, or
// if there's genuinely nothing to summarize (an image-only report). Never
// throws — a failure here just leaves the report untitled, which the UI
// already handles by falling back to the message/transcript/"Voice note".
export async function ensureFeedbackTitle(id: string): Promise<void> {
  const meta = getFeedbackMeta(id);
  if (!meta || meta.title) return; // gone, or already titled

  let text = getFeedbackText(id); // message, or an already-cached transcript
  if (!text) {
    // A voice note with no transcript yet — transcribe it so there's
    // something to summarize. Cost is attributed to the reporter, since
    // it's their report that caused it.
    const audio = getFeedbackAudio(id);
    if (audio?.audio_base64) {
      try {
        const result = await transcribeFeedbackAudio(
          Buffer.from(audio.audio_base64, "base64"),
          audio.audio_mime ?? "audio/mp4",
          meta.user_id,
        );
        const transcribed = result.text?.trim();
        if (transcribed) {
          setFeedbackTranscript(id, transcribed);
          text = transcribed;
        }
      } catch (err) {
        console.error(`[feedbackAutoTitle] transcribe failed for ${id}:`, err);
        return;
      }
    }
  }
  if (!text) return; // nothing to summarize (e.g. image-only report)

  const summary = await summarizeFeedback(text);
  if (summary) setFeedbackTitleSummary(id, summary.title, summary.summary);
}

// Fire-and-forget wrapper for the submit path — logs its own errors so a
// caller can `void` it without an unhandled rejection.
export function autoTitleInBackground(id: string): void {
  void ensureFeedbackTitle(id).catch((err) =>
    console.error(`[feedbackAutoTitle] background titling failed for ${id}:`, err),
  );
}

// Titles every pre-existing report that doesn't have one yet — run once in
// the background after the server starts, so "update all the current
// reports" happens automatically on deploy with no manual step. Idempotent
// and self-healing: anything interrupted by a restart is picked up on the
// next boot, and once a report is titled it's never reprocessed. Sequential
// with a small gap so a backlog of voice notes doesn't spike the STT/LLM
// providers all at once.
export async function backfillMissingTitles(): Promise<void> {
  const ids = listFeedbackIdsNeedingTitle();
  if (ids.length === 0) return;
  console.log(`[feedbackAutoTitle] backfilling ${ids.length} report(s) without a title…`);
  for (const id of ids) {
    try {
      await ensureFeedbackTitle(id);
    } catch (err) {
      console.error(`[feedbackAutoTitle] backfill failed for ${id}:`, err);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  console.log("[feedbackAutoTitle] backfill complete.");
}
