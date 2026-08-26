import type { FoodEntry, Targets } from "../api/client";
import { Ring } from "./Ring";

interface DaySummaryProps {
  entries: FoodEntry[];
  targets: Targets | null;
}

// Today-style summary: a remaining-calories ring plus goal/consumed figures and
// per-macro remaining bars, all computed from the selected day's entries.
export function DaySummary({ entries, targets }: DaySummaryProps) {
  const sum = (pick: (e: FoodEntry) => number | null) =>
    Math.round(entries.reduce((s, e) => s + (pick(e) ?? 0), 0));

  const consumed = sum((e) => e.calories);
  const protein = sum((e) => e.protein_g);
  const carbs = sum((e) => e.carbs_g);
  const fat = sum((e) => e.fat_g);

  const goal = targets?.calorie_target ?? null;
  const remaining = goal != null ? goal - consumed : null;
  const over = goal != null && consumed > goal;

  return (
    <div className="calorie-total day-summary">
      <div className="day-summary-top">
        <div className="day-summary-figures">
          <div className="summary-figure">
            <span className="summary-figure-label">Goal</span>
            <span className="summary-figure-value">
              {goal != null ? goal : "—"} <em>kcal</em>
            </span>
          </div>
          <div className="summary-figure">
            <span className="summary-figure-label">Consumed</span>
            <span className="summary-figure-value">
              {consumed} <em>kcal</em>
            </span>
          </div>
        </div>

        <Ring size={148} stroke={14} pct={goal ? consumed / goal : 0} over={over}>
          {goal != null ? (
            <>
              <span className="ring-value">{Math.abs(remaining as number)}</span>
              <span className="ring-sub">kcal {over ? "over" : "left"}</span>
            </>
          ) : (
            <>
              <span className="ring-value">{consumed}</span>
              <span className="ring-sub">kcal</span>
            </>
          )}
        </Ring>
      </div>

      {targets ? (
        <div className="macro-row">
          <Macro name="Protein" consumed={protein} target={targets.protein_target_g} />
          <Macro name="Carbs" consumed={carbs} target={targets.carbs_target_g} />
          <Macro name="Fat" consumed={fat} target={targets.fat_target_g} />
        </div>
      ) : (
        <p className="stats-hint">Complete your profile to see your target and macros here.</p>
      )}
    </div>
  );
}

function Macro({ name, consumed, target }: { name: string; consumed: number; target: number }) {
  const pct = target > 0 ? Math.min(1, consumed / target) : 0;
  const over = consumed > target;
  const diff = Math.abs(target - consumed);
  return (
    <div className="macro">
      <div className="macro-name">{name}</div>
      <div className="macro-bar">
        <div
          className={over ? "macro-bar-fill over" : "macro-bar-fill"}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <div className="macro-sub">
        {diff}g {over ? "over" : "left"}
      </div>
    </div>
  );
}
