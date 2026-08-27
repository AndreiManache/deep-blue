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
  created_at: string;
  status: string;
}

// Newest first — that's what an admin triaging a small trickle of reports
// wants to see.
const listStmt = db.prepare(`
  SELECT f.id, u.username, f.message, f.audio_base64, f.audio_mime, f.log_snapshot, f.created_at, f.status
    FROM feedback f
    JOIN users u ON u.id = f.user_id
   ORDER BY f.created_at DESC
`);

export function listFeedback(): FeedbackRow[] {
  return listStmt.all() as unknown as FeedbackRow[];
}

const updateStatusStmt = db.prepare(`UPDATE feedback SET status = :status WHERE id = :id`);

export function setFeedbackStatus(id: string, status: "new" | "reviewed"): boolean {
  const result = updateStatusStmt.run({ id, status });
  return Number(result.changes) > 0;
}
