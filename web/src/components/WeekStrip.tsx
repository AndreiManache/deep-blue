import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { dayKey, todayKey, type DailyStat } from "../api/client";
import { useLanguage } from "../i18n/LanguageContext";
import { useT } from "../i18n/useT";
import { cn } from "../lib/utils";

interface WeekStripProps {
  selected: string; // YYYY-MM-DD
  stats: DailyStat[]; // recent days from fetchStats
  onSelect: (day: string) => void;
}

// The 7-day strip (Mon..Sun) that contains the selected day. A coral dot marks
// days that have logged food; a sky dot marks today.
export function WeekStrip({ selected, stats, onSelect }: WeekStripProps) {
  const t = useT();
  const { language } = useLanguage();
  const locale = language === "ro" ? "ro-RO" : "en-US";
  const today = todayKey();
  const daysWithData = useMemo(
    () => new Set(stats.filter((s) => s.logged).map((s) => s.date)),
    [stats],
  );

  const weekDays = useMemo(() => {
    const sel = new Date(selected + "T00:00:00");
    const dow = (sel.getDay() + 6) % 7; // Monday = 0
    const monday = new Date(sel);
    monday.setDate(sel.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return dayKey(d);
    });
  }, [selected]);

  function shift(days: number) {
    const sel = new Date(selected + "T00:00:00");
    sel.setDate(sel.getDate() + days);
    onSelect(dayKey(sel));
  }

  const isCurrentWeek = weekDays.includes(today);
  const first = weekDays[0] ?? today;
  const last = weekDays[6] ?? today;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-ink/40">
          {new Date(first + "T00:00:00").toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
          })}{" "}
          –{" "}
          {new Date(last + "T00:00:00").toLocaleDateString(locale, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <div className="flex gap-2">
          <button
            className="grid size-9 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
            onClick={() => shift(-7)}
            aria-label={t("weekStrip.previousWeek")}
          >
            <ChevronLeft className="size-4 text-ink/70" />
          </button>
          <button
            className={cn(
              "grid size-9 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-ink/5 transition-colors",
              isCurrentWeek ? "cursor-default opacity-40" : "hover:bg-ink3",
            )}
            onClick={() => shift(7)}
            disabled={isCurrentWeek}
            aria-label={t("weekStrip.nextWeek")}
          >
            <ChevronRight className="size-4 text-ink/70" />
          </button>
        </div>
      </div>
      <div className="flex gap-1.5">
        {weekDays.map((day) => {
          const isSelected = day === selected;
          const isToday = day === today;
          const hasData = daysWithData.has(day);
          return (
            <button
              key={day}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 rounded-2xl px-1 py-2 transition-colors",
                isSelected ? "bg-ink" : "bg-white ring-1 ring-ink/5 hover:bg-ink3",
              )}
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={`${new Date(day + "T00:00:00").toDateString()}${isToday ? " (today)" : ""}${hasData ? ", has entries" : ""}`}
            >
              <span
                className={cn(
                  "text-[11px] font-bold uppercase",
                  isSelected ? "text-white/60" : "text-ink/40",
                )}
              >
                {new Date(day + "T00:00:00").toLocaleDateString(locale, {
                  weekday: "short",
                })}
              </span>
              <span
                className={cn(
                  "font-display text-lg font-extrabold leading-none",
                  isSelected ? "text-white" : "text-ink",
                )}
              >
                {new Date(day + "T00:00:00").getDate()}
              </span>
              <span
                className={cn(
                  "mt-1 size-1.5 rounded-full",
                  hasData
                    ? "bg-coral"
                    : isToday
                      ? "bg-sky"
                      : isSelected
                        ? "bg-white/25"
                        : "bg-ink/10",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
