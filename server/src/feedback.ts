import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export interface CreateFeedbackInput {
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO feedback (id, user_id, message, audio_base64, audio_mime, log_snapshot, created_at, status)
  VALUES (:id, :user_id, :message, :audio_base64, :audio_mime, :log_snapshot, :created_at, 'new')
`);

export function createFeedback(userId: string, input: CreateFeedbackInput): string {
  const id = randomUUID();
  insertStmt.run({
    id,
    user_id: userId,
    message: input.message,
    audio_base64: input.audio_base64,
    audio_mime: input.audio_mime,
    log_snapshot: input.log_snapshot,
    created_at: new Date().toISOString(),
  });
  return id;
}

export interface FeedbackRow {
  id: string;
  username: string;
  message: string | null;
  audio_base64: string | null;
  audio_mime: string | null;
  log_snapshot: string | null;
  transcript: string | null;
  created_at: string;
  status: string;
  resolution_note: string | null;
}

// Newest first — that's what an admin triaging a small trickle of reports
// wants to see.
const listStmt = db.prepare(`
  SELECT f.id, u.username, f.message, f.audio_base64, f.audio_mime, f.log_snapshot, f.transcript, f.created_at, f.status, f.resolution_note
    FROM feedback f
    JOIN users u ON u.id = f.user_id
   ORDER BY f.created_at DESC
`);

export function listFeedback(): FeedbackRow[] {
  return listStmt.all() as unknown as FeedbackRow[];
}

export interface MyFeedbackRow {
  id: string;
  message: string | null;
  transcript: string | null;
  has_audio: number; // SQLite has no boolean; 0/1, cast on the way out
  created_at: string;
  status: string;
  resolution_note: string | null;
}

// The reporter's own view (2026-08-29's "My Feedback" screen) — no
// admin-only fields (log_snapshot, raw audio) since this is read-only and
// scoped to their own submissions; has_audio is enough to show "voice note
// attached" without shipping the blob back down.
const listForUserStmt = db.prepare(`
  SELECT id, message, transcript, (audio_base64 IS NOT NULL) AS has_audio, created_at, status, resolution_note
    FROM feedback
   WHERE user_id = :user_id
   ORDER BY created_at DESC
`);

export function listFeedbackForUser(userId: string): MyFeedbackRow[] {
  return listForUserStmt.all({ user_id: userId }) as unknown as MyFeedbackRow[];
}

const updateStatusStmt = db.prepare(`UPDATE feedback SET status = :status WHERE id = :id`);

export function setFeedbackStatus(id: string, status: "new" | "reviewed"): boolean {
  const result = updateStatusStmt.run({ id, status });
  return Number(result.changes) > 0;
}

const updateResolutionNoteStmt = db.prepare(`UPDATE feedback SET resolution_note = :resolution_note WHERE id = :id`);

export function setFeedbackResolutionNote(id: string, note: string | null): boolean {
  const result = updateResolutionNoteStmt.run({ id, resolution_note: note });
  return Number(result.changes) > 0;
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
