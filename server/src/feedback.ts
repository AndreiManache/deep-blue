import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export interface CreateFeedbackInput {
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
  image_base64: string | null;
  image_mime: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO feedback (id, user_id, message, audio_base64, audio_mime, log_snapshot, image_base64, image_mime, created_at, status, ticket_number)
  VALUES (:id, :user_id, :message, :audio_base64, :audio_mime, :log_snapshot, :image_base64, :image_mime, :created_at, 'new', :ticket_number)
`);

const nextTicketNumberStmt = db.prepare(`SELECT COALESCE(MAX(ticket_number), 0) + 1 AS next FROM feedback`);

export function createFeedback(userId: string, input: CreateFeedbackInput): string {
  const id = randomUUID();
  const ticketNumber = (nextTicketNumberStmt.get() as { next: number }).next;
  insertStmt.run({
    id,
    user_id: userId,
    message: input.message,
    audio_base64: input.audio_base64,
    audio_mime: input.audio_mime,
    log_snapshot: input.log_snapshot,
    image_base64: input.image_base64,
    image_mime: input.image_mime,
    created_at: new Date().toISOString(),
    ticket_number: ticketNumber,
  });
  return id;
}

export interface FeedbackRow {
  id: string;
  ticket_number: number;
  username: string;
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
  transcript: string | null;
  created_at: string;
  status: string;
  resolution_note: string | null;
  title: string | null;
  summary: string | null;
  image_base64: string | null;
  image_mime: string | null;
}

// Newest first — that's what an admin triaging a small trickle of reports
// wants to see.
const listStmt = db.prepare(`
  SELECT f.id, f.ticket_number, u.username, f.message, f.audio_base64, f.audio_mime, f.log_snapshot, f.transcript, f.created_at, f.status, f.resolution_note, f.title, f.summary, f.image_base64, f.image_mime
    FROM feedback f
    JOIN users u ON u.id = f.user_id
   ORDER BY f.created_at DESC
`);

export function listFeedback(): FeedbackRow[] {
  return listStmt.all() as unknown as FeedbackRow[];
}

export interface MyFeedbackRow {
  id: string;
  ticket_number: number;
  message: string | null;
  transcript: string | null;
  has_audio: number; // SQLite has no boolean; 0/1, cast on the way out
  created_at: string;
  status: string;
  resolution_note: string | null;
  title: string | null;
  summary: string | null;
  image_base64: string | null;
  image_mime: string | null;
}

// The reporter's own view (2026-08-29's "My Feedback" screen) — no
// admin-only fields (log_snapshot, raw audio) since this is read-only and
// scoped to their own submissions; has_audio is enough to show "voice note
// attached" without shipping the blob back down. summary IS included
// (2026-08-31, card redesign) — the reporter's own card now shows title +
// short description, same as the admin inbox. The photo is included too,
// unlike audio — already small after client-side resize, and unlike a raw
// recording it's cheap to just show back to the reporter so they can
// confirm what they attached.
const listForUserStmt = db.prepare(`
  SELECT id, ticket_number, message, transcript, (audio_base64 IS NOT NULL) AS has_audio, created_at, status, resolution_note, title, summary, image_base64, image_mime
    FROM feedback
   WHERE user_id = :user_id
   ORDER BY created_at DESC
`);

export function listFeedbackForUser(userId: string): MyFeedbackRow[] {
  return listForUserStmt.all({ user_id: userId }) as unknown as MyFeedbackRow[];
}

const updateStatusStmt = db.prepare(`UPDATE feedback SET status = :status WHERE id = :id`);

// 'completed' (2026-08-31) is the explicit "Andrei marked this fixed"
// signal that moves a report into the reporter's collapsed "Fixed issues"
// section — distinct from 'reviewed', which is just admin-side triage
// bookkeeping and doesn't necessarily mean the issue was resolved.
export function setFeedbackStatus(id: string, status: "new" | "reviewed" | "completed"): boolean {
  const result = updateStatusStmt.run({ id, status });
  return Number(result.changes) > 0;
}

const updateResolutionNoteStmt = db.prepare(`UPDATE feedback SET resolution_note = :resolution_note WHERE id = :id`);

export function setFeedbackResolutionNote(id: string, note: string | null): boolean {
  const result = updateResolutionNoteStmt.run({ id, resolution_note: note });
  return Number(result.changes) > 0;
}

const updateTitleSummaryStmt = db.prepare(`UPDATE feedback SET title = :title, summary = :summary WHERE id = :id`);

export function setFeedbackTitleSummary(id: string, title: string, summary: string): boolean {
  const result = updateTitleSummaryStmt.run({ id, title, summary });
  return Number(result.changes) > 0;
}

const getTextStmt = db.prepare(`SELECT message, transcript FROM feedback WHERE id = :id`);

// Whatever there is to summarize for a report — the typed message if any,
// else the transcript (voice notes have no message). Null if there's
// nothing yet (e.g. an untranscribed voice note) — the caller should ask
// for a transcript first in that case.
export function getFeedbackText(id: string): string | null {
  const row = getTextStmt.get({ id }) as unknown as { message: string | null; transcript: string | null } | undefined;
  const text = row?.message ?? row?.transcript ?? null;
  return text && text.trim() ? text : null;
}

const getMetaStmt = db.prepare(`SELECT user_id, title FROM feedback WHERE id = :id`);

// user_id (for attributing any auto-transcription cost back to the reporter)
// and title (to skip a report that's already been titled). Used by the
// auto-title pipeline — see feedbackAutoTitle.ts.
export function getFeedbackMeta(id: string): { user_id: string; title: string | null } | undefined {
  return getMetaStmt.get({ id }) as unknown as { user_id: string; title: string | null } | undefined;
}

// Every report that still needs an AI title/summary generated: no title yet,
// but has something to summarize (a typed message, or an audio note we can
// transcribe first). Oldest first so a backfill processes them in the order
// they came in. Drives both the on-submit auto-title and the startup
// backfill that catches every pre-existing report.
const idsNeedingTitleStmt = db.prepare(`
  SELECT id FROM feedback
   WHERE title IS NULL AND (message IS NOT NULL OR audio_base64 IS NOT NULL)
   ORDER BY created_at ASC
`);

export function listFeedbackIdsNeedingTitle(): string[] {
  return (idsNeedingTitleStmt.all() as unknown as { id: string }[]).map((r) => r.id);
}

const getAudioStmt = db.prepare(`SELECT audio_base64, audio_mime FROM feedback WHERE id = :id`);

export function getFeedbackAudio(id: string): { audio_base64: string; audio_mime: string | null } | null {
  const row = getAudioStmt.get({ id }) as unknown as
    | { audio_base64: string | null; audio_mime: string | null }
    | undefined;
  if (!row?.audio_base64) return null;
  return { audio_base64: row.audio_base64, audio_mime: row.audio_mime };
}

const setTranscriptStmt = db.prepare(`UPDATE feedback SET transcript = :transcript WHERE id = :id`);

export function setFeedbackTranscript(id: string, transcript: string): void {
  setTranscriptStmt.run({ id, transcript });
}

const deleteStmt = db.prepare(`DELETE FROM feedback WHERE id = :id`);

export function deleteFeedback(id: string): boolean {
  const result = deleteStmt.run({ id });
  return Number(result.changes) > 0;
}
