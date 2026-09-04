import { useEffect, useState } from "react";
import { GlassWater } from "lucide-react";
import { ApiError, fetchWaterCount, setWaterToday, todayKey } from "../api/client";
import { useT } from "../i18n/useT";
import { cn } from "../lib/utils";

// Fixed daily target for v1 (not yet configurable) — a common "8 glasses a
// day" rule of thumb. Revisit if a personalized target is wanted later.
const DAILY_TARGET = 8;

interface WaterTrackerProps {
  selectedDay: string;
  // Bumped whenever a voice turn might have logged water, same signal
  // Dashboard already uses to refetch food entries.
  refreshSignal: number;
}

// A row of glass icons that fill in with color as the day's count goes up —
// tapping a glass jumps the day's level to that glass's position (like a
// star-rating widget: tap the 5th glass to set today to 5; tap the current
// last filled glass again to drop back by one). Voice logging ("I had a
// glass of water" -> log_water) adds instead of setting, and this just
// reflects whatever the count ends up being either way.
export function WaterTracker({ selectedDay, refreshSignal }: WaterTrackerProps) {
  const t = useT();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isToday = selectedDay === todayKey();

  useEffect(() => {
    fetchWaterCount(selectedDay)
      .then(setCount)
      .catch((err) => setError(err instanceof ApiError ? err.message : t("water.loadError")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, refreshSignal]);

  async function handleTapGlass(index: number) {
    if (!isToday || count == null) return; // only today's count is editable
    const previous = count;
    const next = previous > index ? index : index + 1;
    setCount(next); // optimistic
    try {
      const confirmed = await setWaterToday(next);
      setCount(confirmed);
    } catch (err) {
      setCount(previous);
      setError(err instanceof ApiError ? err.message : t("water.loadError"));
    }
  }

  if (count == null && !error) return null; // first load — nothing to show yet, avoid a layout flash

  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink/40">{t("water.title")}</h3>
        {count != null && (
          <span className="text-xs font-semibold text-ink/40">
            {t("water.glassesOf", { count, target: DAILY_TARGET })}
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-coral">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {Array.from({ length: DAILY_TARGET }, (_, i) => {
          const filled = count != null && i < count;
          return (
            <button
              key={i}
              type="button"
              disabled={!isToday}
              onClick={() => handleTapGlass(i)}
              aria-label={t("water.glassLabel", { n: i + 1 })}
              className={cn(
                "grid size-10 place-items-center rounded-xl transition-colors",
                filled ? "bg-sky/15 text-sky" : "bg-cream text-ink/25",
                isToday && "hover:bg-sky/10",
              )}
            >
              <GlassWater className="size-5" fill={filled ? "currentColor" : "none"} fillOpacity={filled ? 0.25 : 0} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
