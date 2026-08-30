import { useCallback, useEffect, useState } from "react";
import {
  editEntry,
  fetchEntries,
  fetchFoodDbStats,
  fetchStats,
  fetchUsageSummary,
  removeEntry,
  todayKey,
  type FoodDbStats,
  type FoodEntry,
  type StatsResponse,
  type UsageSummary,
} from "../api/client";
import { BackHeader } from "./BackHeader";
import { DaySummary } from "./DaySummary";
import { EntryRow } from "./EntryRow";
import { UsageCostCard } from "./UsageCostCard";
import { WeekStrip } from "./WeekStrip";

interface DashboardProps {
  onBack: () => void;
  refreshSignal: number;
}

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function Dashboard({ onBack, refreshSignal }: DashboardProps) {
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Growth snapshot ("14 foods verified, 46 are yours") — a nice-to-have, so
  // failure just leaves it unshown rather than surfacing an error banner.
  const [foodStats, setFoodStats] = useState<FoodDbStats | null>(null);
  // Rough estimated-spend snapshot — same "fail silently" treatment as
  // foodStats above.
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const load = useCallback(async (day: string) => {
    setError(null);
    try {
      const [e, s] = await Promise.all([fetchEntries(day), fetchStats(7)]);
      setEntries(e);
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedDay);
  }, [selectedDay, load]);

  // Refetch whenever the voice conversation mutated the log.
  useEffect(() => {
    if (refreshSignal > 0) void load(selectedDay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Once on open, then again whenever logging might have added a new food —
  // cheap enough at this scale (see getFoodDbStats) that refetching on every
  // mutation isn't a concern.
  useEffect(() => {
    fetchFoodDbStats()
      .then(setFoodStats)
      .catch(() => {});
    fetchUsageSummary()
      .then(setUsage)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  async function handleChanged() {
    void load(selectedDay);
  }

  const isToday = selectedDay === todayKey();
  const selDate = parseLocalDate(selectedDay);
  const title = isToday ? "Today" : selDate.toLocaleDateString(undefined, { weekday: "long" });
  const subtitle = selDate.toLocaleDateString(undefined, { month: "long", day: "numeric" });

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title={title} subtitle={subtitle} onBack={onBack} />

      {stats && <WeekStrip selected={selectedDay} stats={stats.days} onSelect={setSelectedDay} />}

      <DaySummary entries={entries} targets={stats?.targets ?? null} selectedDay={selectedDay} />

      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="py-6 text-center text-sm font-medium text-ink/40">
          {isToday ? "Nothing logged yet today." : "Nothing logged on this day."}
        </p>
      )}

      {entries.length > 0 && (
        <div className="rounded-[2rem] bg-white px-5 shadow-sm ring-1 ring-ink/5">
          {entries.map((entry, i) => (
            <div key={entry.id} className={i > 0 ? "border-t border-ink/5" : ""}>
              <EntryRow entry={entry} onChanged={handleChanged} />
            </div>
          ))}
        </div>
      )}

      {foodStats && (foodStats.yours > 0 || foodStats.verified > 0) && (
        <p className="text-center text-xs font-medium text-ink/35">
          {foodStats.verified} food{foodStats.verified === 1 ? "" : "s"} verified · {foodStats.yours}{" "}
          {foodStats.yours === 1 ? "is" : "are"} yours
        </p>
      )}

      {usage && <UsageCostCard usage={usage} />}
    </div>
  );
}
