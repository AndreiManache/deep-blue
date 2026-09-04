import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  editEntry,
  fetchDayInsight,
  fetchEntries,
  fetchFoodDbStats,
  fetchStats,
  removeEntry,
  todayKey,
  type FoodDbStats,
  type FoodEntry,
  type StatsResponse,
} from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useT, type StringKey } from "../i18n/useT";
import { BackHeader } from "./BackHeader";
import { DaySummary } from "./DaySummary";
import { EntryRow } from "./EntryRow";
import { WaterTracker } from "./WaterTracker";
import { WeekStrip } from "./WeekStrip";
import { WorkoutTracker } from "./WorkoutTracker";

interface DashboardProps {
  onBack: () => void;
  refreshSignal: number;
}

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Groups logged entries into Breakfast/Lunch/Dinner by time of day (2026-08-31
// backlog item) — before noon is breakfast, noon to 6pm is lunch, 6pm on is
// dinner. Entries already arrive sorted oldest-first (see entries.ts), so
// each bucket stays chronological; only non-empty buckets are shown, in
// meal order rather than whichever happened to be logged first.
type MealLabel = "dashboard.mealBreakfast" | "dashboard.mealLunch" | "dashboard.mealDinner";
const MEAL_ORDER: MealLabel[] = ["dashboard.mealBreakfast", "dashboard.mealLunch", "dashboard.mealDinner"];

function mealFor(createdAt: string): MealLabel {
  const hour = new Date(createdAt).getHours();
  if (hour < 12) return "dashboard.mealBreakfast";
  if (hour < 18) return "dashboard.mealLunch";
  return "dashboard.mealDinner";
}

function groupByMeal(entries: FoodEntry[]): { label: MealLabel; entries: FoodEntry[] }[] {
  const buckets = new Map<MealLabel, FoodEntry[]>();
  for (const entry of entries) {
    const label = mealFor(entry.created_at);
    (buckets.get(label) ?? buckets.set(label, []).get(label)!).push(entry);
  }
  return MEAL_ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    entries: buckets.get(label)!,
  }));
}

export function Dashboard({ onBack, refreshSignal }: DashboardProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === "ro" ? "ro-RO" : "en-US";
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const [entries, setEntries] = useState<FoodEntry[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Growth snapshot ("14 foods verified, 46 are yours") — a nice-to-have, so
  // failure just leaves it unshown rather than surfacing an error banner.
  const [foodStats, setFoodStats] = useState<FoodDbStats | null>(null);
  // AI-generated "how's your day going" comment — same fail-silently
  // treatment as foodStats above. Cleared on day/entry-count change so a
  // stale comment from a previous day never lingers while the new one loads.
  const [insight, setInsight] = useState<string | null>(null);

  const load = useCallback(async (day: string) => {
    setError(null);
    try {
      const [e, s] = await Promise.all([fetchEntries(day), fetchStats(7)]);
      setEntries(e);
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.loadError"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Regenerates whenever the day changes or the number of logged items
  // changes (the server caches by entry count too, so reopening the same
  // day with nothing new logged doesn't re-spend an LLM call).
  useEffect(() => {
    setInsight(null);
    if (entries.length === 0) return;
    let cancelled = false;
    fetchDayInsight(selectedDay).then((result) => {
      if (!cancelled) setInsight(result);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedDay, entries.length]);

  async function handleChanged() {
    void load(selectedDay);
  }

  const isToday = selectedDay === todayKey();
  const selDate = parseLocalDate(selectedDay);
  const title = isToday ? t("dashboard.today") : selDate.toLocaleDateString(locale, { weekday: "long" });
  const subtitle = selDate.toLocaleDateString(locale, { month: "long", day: "numeric" });

  return (
    <div className="flex min-h-dvh flex-col gap-6 px-6 pb-16 pt-5">
      <BackHeader title={title} subtitle={subtitle} onBack={onBack} />

      {stats && <WeekStrip selected={selectedDay} stats={stats.days} onSelect={setSelectedDay} />}

      <DaySummary entries={entries} targets={stats?.targets ?? null} selectedDay={selectedDay} />

      <WaterTracker selectedDay={selectedDay} refreshSignal={refreshSignal} />

      <WorkoutTracker selectedDay={selectedDay} refreshSignal={refreshSignal} />

      {insight && (
        <div className="flex items-start gap-3 rounded-2xl bg-ink px-5 py-4 text-cream shadow-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-sun" />
          <p className="text-sm font-semibold leading-relaxed">{insight}</p>
        </div>
      )}

      {error && (
        <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
          {error}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="py-6 text-center text-sm font-medium text-ink/40">
          {isToday ? t("dashboard.nothingToday") : t("dashboard.nothingThisDay")}
        </p>
      )}

      {groupByMeal(entries).map((group) => (
        <div key={group.label}>
          <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-ink/40">
            {t(group.label as StringKey)}
          </h3>
          <div className="rounded-[2rem] bg-white px-5 shadow-sm ring-1 ring-ink/5">
            {group.entries.map((entry, i) => (
              <div key={entry.id} className={i > 0 ? "border-t border-ink/5" : ""}>
                <EntryRow entry={entry} onChanged={handleChanged} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {foodStats && (foodStats.yours > 0 || foodStats.verified > 0) && (
        <p className="text-center text-xs font-medium text-ink/35">
          {t("dashboard.foodsVerified", {
            verified: foodStats.verified,
            yours: foodStats.yours,
            isAre: foodStats.yours === 1 ? "is" : "are",
          })}
        </p>
      )}
    </div>
  );
}
