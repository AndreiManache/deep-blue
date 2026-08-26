import { useCallback, useEffect, useState } from "react";
import {
  editEntry,
  fetchEntries,
  fetchStats,
  removeEntry,
  type FoodEntry,
  type StatsResponse,
} from "../api/client";
import { DaySummary } from "./DaySummary";
import { EntryRow } from "./EntryRow";
import { StatsPanel } from "./StatsPanel";
import { WeekStrip } from "./WeekStrip";

interface DashboardProps {
  onBack: () => void;
  refreshSignal: number;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// The week strip shows the last 7 days ending today.
const WEEK = 7;

export function Dashboard({ onBack, refreshSignal }: DashboardProps) {
  const [selectedDate, setSelectedDate] = useState<string>(localToday);
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEntries = useCallback(async (date: string) => {
    try {
      setEntries(await fetchEntries(date));
      setError(null);
    } catch {
      setError("Could not load entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Week rings + targets. Always the last 7 days ending today, independent of
  // which day is selected.
  const loadStats = useCallback(async () => {
    try {
      setStats(await fetchStats(WEEK));
    } catch {
      /* the summary/rings just fall back to a no-target state */
    }
  }, []);

  useEffect(() => {
    void loadEntries(selectedDate);
  }, [loadEntries, selectedDate, refreshSignal]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, refreshSignal]);

  async function handleSave(id: string, fields: { description: string; calories: number }) {
    const updated = await editEntry(id, fields);
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
    void loadStats(); // calories changed — refresh the rings
  }

  async function handleDelete(id: string) {
    await removeEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
    void loadStats();
  }

  const isToday = selectedDate === localToday();
  const selDate = parseLocalDate(selectedDate);
  const title = isToday ? "Today" : selDate.toLocaleDateString(undefined, { weekday: "long" });
  const subtitle = selDate.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <button className="back-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="dashboard-title">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      {stats && (
        <WeekStrip
          days={stats.days}
          targets={stats.targets}
          selected={selectedDate}
          onSelect={setSelectedDate}
        />
      )}

      <DaySummary entries={entries} targets={stats?.targets ?? null} />

      {error && <div className="empty-state">{error}</div>}

      {!loading && !error && entries.length === 0 && (
        <div className="empty-state">
          {isToday ? "Nothing logged yet today." : "Nothing logged on this day."}
        </div>
      )}

      <div className="entry-list">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onSave={handleSave} onDelete={handleDelete} />
        ))}
      </div>

      <StatsPanel refreshSignal={refreshSignal} />
    </div>
  );
}
