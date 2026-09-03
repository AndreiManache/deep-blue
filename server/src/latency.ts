import { db } from "./db.js";

// The admin panel's "how fast is the model actually replying" reality check
// (2026-09-03). Every /chat turn records its end-to-end server time as a
// usage_log row (kind "chat_latency_ms", amount = milliseconds); this reads
// those back as a small summary. Latency here is the whole server-side reply
// time the user waits on — the model tool-loop AND voice synthesis — not the
// model call alone, since that total is what "response time" means to a user.
//
// p95 is included alongside the average on purpose: this app's latency problem
// was never the median (a couple of seconds) but a heavy tail that spiked to
// 18-35s, so an average alone would hide exactly the thing worth watching.

export interface LatencyStats {
  count: number;
  avg_ms: number | null;
  p95_ms: number | null;
  // Same three, but only over the last 7 days — so a model/config change shows
  // up here promptly instead of being drowned out by all-time history.
  recent_count: number;
  recent_avg_ms: number | null;
}

const overallStmt = db.prepare(
  `SELECT COUNT(*) AS count, AVG(amount) AS avg_ms FROM usage_log WHERE kind = 'chat_latency_ms'`,
);
// p95 by ordered offset: the value at the 95th-percentile rank. Clamped so a
// tiny sample (offset past the last row) still returns the slowest seen.
const p95Stmt = db.prepare(
  `SELECT amount FROM usage_log WHERE kind = 'chat_latency_ms' ORDER BY amount ASC LIMIT 1 OFFSET :offset`,
);
const recentStmt = db.prepare(
  `SELECT COUNT(*) AS count, AVG(amount) AS avg_ms
     FROM usage_log WHERE kind = 'chat_latency_ms' AND created_at >= :since`,
);

const round = (n: number | null): number | null => (n == null ? null : Math.round(n));

export function getChatLatencyStats(): LatencyStats {
  const overall = overallStmt.get() as { count: number; avg_ms: number | null };

  let p95_ms: number | null = null;
  if (overall.count > 0) {
    // 0-based rank of the 95th percentile, clamped to the last row.
    const offset = Math.min(overall.count - 1, Math.floor(0.95 * (overall.count - 1)));
    const row = p95Stmt.get({ offset }) as { amount: number } | undefined;
    p95_ms = row ? Math.round(row.amount) : null;
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = recentStmt.get({ since }) as { count: number; avg_ms: number | null };

  return {
    count: overall.count,
    avg_ms: round(overall.avg_ms),
    p95_ms,
    recent_count: recent.count,
    recent_avg_ms: round(recent.avg_ms),
  };
}
