import { useEffect, useState } from "react";
import { Dumbbell, Trash2 } from "lucide-react";
import { ApiError, fetchWorkouts, removeWorkout, timeLabel, type WorkoutEntry } from "../api/client";
import { useT } from "../i18n/useT";

interface WorkoutTrackerProps {
  selectedDay: string;
  refreshSignal: number;
}

// Deliberately just a list — no calories-burned figure, no effect on the
// calorie target (ticket #18, Andrei's explicit call: "just record it").
// Unlike WaterTracker, this card doesn't render at all on a day with
// nothing logged — a workout is occasional, not a daily target to always
// show progress against, so an empty card here would just be clutter.
export function WorkoutTracker({ selectedDay, refreshSignal }: WorkoutTrackerProps) {
  const t = useT();
  const [workouts, setWorkouts] = useState<WorkoutEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkouts(selectedDay)
      .then(setWorkouts)
      .catch((err) => setError(err instanceof ApiError ? err.message : t("workout.loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, refreshSignal]);

  async function handleDelete(id: string) {
    const previous = workouts;
    setWorkouts((w) => w.filter((entry) => entry.id !== id)); // optimistic
    try {
      await removeWorkout(id);
    } catch (err) {
      setWorkouts(previous);
      setError(err instanceof ApiError ? err.message : t("workout.deleteError"));
    }
  }

  if (workouts.length === 0 && !error) return null;

  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink/40">
        <Dumbbell className="size-4 text-leaf" />
        {t("workout.title")}
      </h3>
      {error && <p className="mb-2 text-xs font-semibold text-coral">{error}</p>}
      <div className="space-y-1">
        {workouts.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-ink/5 py-2.5 last:border-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-ink">{entry.description}</div>
              <div className="text-xs font-medium text-ink/40">
                {timeLabel(entry.created_at)}
                {entry.duration_minutes != null && ` · ${t("workout.minutes", { n: entry.duration_minutes })}`}
              </div>
            </div>
            <button
              type="button"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-coral/60 transition-colors hover:bg-coral/10 hover:text-coral"
              onClick={() => handleDelete(entry.id)}
              aria-label={t("workout.deleteLabel")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
