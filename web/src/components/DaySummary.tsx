import { useMemo } from "react";
import { todayKey, type FoodEntry, type Targets } from "../api/client";
import { useT } from "../i18n/useT";
import { Ring } from "./Ring";

interface DaySummaryProps {
  entries: FoodEntry[];
  targets: Targets | null;
  selectedDay: string;
}

function sum(entries: FoodEntry[]) {
  return {
    kcal: entries.reduce((a, e) => a + (e.calories || 0), 0),
    protein_g: entries.reduce((a, e) => a + (e.protein_g || 0), 0),
    carbs_g: entries.reduce((a, e) => a + (e.carbs_g || 0), 0),
    fat_g: entries.reduce((a, e) => a + (e.fat_g || 0), 0),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// The white headline card: big calorie ring + small protein/carbs/fat rings.
export function DaySummary({ entries, targets, selectedDay }: DaySummaryProps) {
  const t = useT();
  const totals = useMemo(() => sum(entries), [entries]);
  const kcalTarget = targets?.calorie_target ?? null;

  const macro = (target: number | null, value: number) => {
    if (!target) return { pct: 0, over: false, value: null as number | null, target };
    return { pct: value / target, over: value > target, value, target };
  };

  const kcalPct = kcalTarget && kcalTarget > 0 ? totals.kcal / kcalTarget : 0;
  const kcalOver = kcalTarget != null && totals.kcal > kcalTarget;

  return (
    <div className="rounded-[2rem] bg-white p-5 shadow-sm ring-1 ring-ink/5">
      <div className="flex items-center gap-4">
        <Ring size={112} stroke={12} pct={kcalPct} over={kcalOver} color="var(--color-sky)">
          <div className="text-center">
            <div className="font-display text-2xl font-extrabold leading-none text-ink">
              {Math.round(totals.kcal)}
            </div>
            <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-ink/40">
              kcal
            </div>
          </div>
        </Ring>
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-ink/40">
            {selectedDay === todayKey() ? t("dashboard.today") : t("dashboard.selectedDay")}
          </div>
          <div className="mt-1 text-sm font-semibold text-ink/60">
            {kcalTarget != null
              ? t("dashboard.leftOf", {
                  left: Math.max(0, Math.round(kcalTarget - totals.kcal)),
                  target: kcalTarget,
                })
              : t("dashboard.noTargetSet")}
          </div>
          <div className="mt-0.5 text-xs font-medium text-ink/40">
            {entries.length} {entries.length === 1 ? t("dashboard.itemLogged") : t("dashboard.itemsLogged")}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <MacroTile label={t("profile.protein")} {...macro(targets?.protein_target_g ?? null, totals.protein_g)} color="var(--color-sky)" t={t} />
        <MacroTile label={t("profile.carbs")} {...macro(targets?.carbs_target_g ?? null, totals.carbs_g)} color="var(--color-sun)" t={t} />
        <MacroTile label={t("profile.fat")} {...macro(targets?.fat_target_g ?? null, totals.fat_g)} color="var(--color-coral)" t={t} />
      </div>
    </div>
  );
}

interface MacroTileProps {
  label: string;
  pct: number;
  over: boolean;
  value: number | null;
  target: number | null;
  color: string;
  t: (key: "daySummary.noTarget") => string;
}

function MacroTile({ label, pct, over, value, target, color, t }: MacroTileProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl bg-cream px-2 py-4">
      <Ring size={72} stroke={9} pct={pct} over={over} color={color}>
        <div className="text-center">
          <div className="font-display text-base font-extrabold leading-none text-ink">
            {value == null ? "—" : round1(value)}
          </div>
          <div className="text-[9px] font-bold uppercase text-ink/40">g</div>
        </div>
      </Ring>
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</div>
        <div className="text-[11px] font-semibold text-ink/40">
          {target == null ? t("daySummary.noTarget") : `/ ${round1(target)}g`}
        </div>
      </div>
    </div>
  );
}
