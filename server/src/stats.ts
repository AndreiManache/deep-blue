import { db } from "./db.js";

export interface DailyStat {
  date: string; // YYYY-MM-DD, a local calendar day
  calories: number;
  protein_g: number;
  // false when nothing was logged that day. A gap is meaningful — "nothing
  // logged" is not the same as "ate nothing" — so blank days are kept in the
  // series (as zeros) and excluded from averages/streaks by the frontend.
  logged: boolean;
}

const sumByDayStmt = db.prepare(`
  SELECT date(created_at, 'localtime') AS day,
         SUM(calories) AS calories,
         SUM(COALESCE(protein_g, 0)) AS protein_g
    FROM food_entries
   WHERE user_id = :user_id
     AND date(created_at, 'localtime') >= :from_day
   GROUP BY day
`);

// Local calendar day as YYYY-MM-DD. Uses the date *fields* (not ms math) so
// month/year rollover and DST transitions are handled by the Date object, and
// it agrees with SQLite's date(created_at,'localtime') under the same TZ.
function localYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Continuous series of the last `days` local calendar days ending today, oldest
// first. Days with no entries come back as logged:false with zero totals rather
// than being omitted, so the chart's x-axis stays continuous.
export function getDailyStats(userId: string, days: number): DailyStat[] {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const rows = sumByDayStmt.all({ user_id: userId, from_day: localYMD(start) }) as unknown as {
    day: string;
    calories: number;
    protein_g: number;
  }[];
  const byDay = new Map(rows.map((r) => [r.day, r]));

  const out: DailyStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = localYMD(d);
    const row = byDay.get(key);
    out.push({
      date: key,
      calories: row ? Math.round(row.calories) : 0,
      protein_g: row ? Math.round(row.protein_g) : 0,
      logged: Boolean(row),
    });
  }
  return out;
}
