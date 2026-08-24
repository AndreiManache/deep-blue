import { useCallback, useEffect, useState } from "react";
import { editEntry, fetchEntries, removeEntry, type FoodEntry } from "../api/client";
import { EntryRow } from "./EntryRow";

interface DashboardProps {
  onBack: () => void;
  refreshSignal: number;
}

export function Dashboard({ onBack, refreshSignal }: DashboardProps) {
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchEntries();
      setEntries(data);
      setError(null);
    } catch {
      setError("Could not load entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  const total = entries.reduce((sum, e) => sum + e.calories, 0);
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  async function handleSave(id: string, fields: { description: string; calories: number }) {
    const updated = await editEntry(id, fields);
    setEntries((prev) => prev.map((e) => (e.id === id ? updated : e)));
  }

  async function handleDelete(id: string) {
    await removeEntry(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <button className="back-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="dashboard-title">
          <h1>Today</h1>
          <p>{today}</p>
        </div>
      </div>

      <div className="calorie-total">
        <span>Total calories</span>
        <span className="value">{total}</span>
      </div>

      {error && <div className="empty-state">{error}</div>}

      {!loading && !error && entries.length === 0 && (
        <div className="empty-state">Nothing logged yet today.</div>
      )}

      <div className="entry-list">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} onSave={handleSave} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
