import type { DailyStat, Targets } from "../api/client";
import { Ring } from "./Ring";

interface WeekStripProps {
  days: DailyStat[];
  targets: Targets | null;
  selected: string; // YYYY-MM-DD
  onSelect: (date: string) => void;
}

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// A tappable week of progress rings — each day's ring fills toward the calorie
// target, turns to the danger color when exceeded, and the selected day drives
// the summary + entry list above/below it.
export function WeekStrip({ days, targets, selected, onSelect }: WeekStripProps) {
  const goal = targets?.calorie_target ?? null;

  return (
    <div className="week-strip" role="group" aria-label="Select a day">
      {days.map((day) => {
        const date = parseLocalDate(day.date);
        const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
        const over = goal != null && day.calories > goal;
        const isSelected = day.date === selected;
        return (
          <button
            key={day.date}
            className={isSelected ? "week-day selected" : "week-day"}
            onClick={() => onSelect(day.date)}
            aria-pressed={isSelected}
            aria-label={`${weekday} ${date.getDate()}${
              day.logged ? `, ${day.calories} kcal` : ", nothing logged"
            }`}
          >
            <span className="week-day-name">{weekday}</span>
            <Ring size={40} stroke={3} pct={goal && day.logged ? day.calories / goal : 0} over={over}>
              <span className="week-day-num">{date.getDate()}</span>
            </Ring>
          </button>
        );
      })}
    </div>
  );
}
