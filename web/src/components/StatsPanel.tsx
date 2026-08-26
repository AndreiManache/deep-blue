import { useEffect, useMemo, useState } from "react";
import { fetchStats, type DailyStat, type StatsResponse } from "../api/client";

interface StatsPanelProps {
  // Bumped whenever a food entry is logged/edited, so trends refresh in step
  // with the day's entry list.
  refreshSignal: number;
}

const RANGES = [7, 30] as const;
type Range = (typeof RANGES)[number];

// Within ±10% of the calorie target counts as "on target" — a neutral "hit the
// number" rule that works for lose/maintain/gain alike, since calorie_target
// already bakes the deficit/surplus in.
const ON_TARGET_BAND = 0.1;

function parseLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function StatsPanel({ refreshSignal }: StatsPanelProps) {
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchStats(range)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch(() => !cancelled && setError("Could not load trends."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, refreshSignal]);

  const summary = useMemo(() => {
    if (!data) return null;
    const logged = data.days.filter((d) => d.logged);
    const loggedCount = logged.length;
    const avg = (pick: (d: DailyStat) => number) =>
      loggedCount ? Math.round(logged.reduce((s, d) => s + pick(d), 0) / loggedCount) : 0;
    const target = data.targets?.calorie_target ?? null;
    const onTarget =
      target != null
        ? logged.filter((d) => Math.abs(d.calories - target) <= target * ON_TARGET_BAND).length
        : null;
    return {
      loggedCount,
      avgCalories: avg((d) => d.calories),
      avgProtein: avg((d) => d.protein_g),
      onTarget,
    };
  }, [data]);

  return (
    <div className="stats-panel">
      <div className="stats-header">
        <h2>Trends</h2>
        <div className="stats-range-toggle" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button
              key={r}
              className={r === range ? "active" : ""}
              onClick={() => setRange(r)}
              aria-pressed={r === range}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      {error && <div className="empty-state">{error}</div>}

      {!error && summary && summary.loggedCount === 0 && !loading && (
        <div className="empty-state">
          No days logged in this range yet — log some meals and your trends will show up here.
        </div>
      )}

      {!error && data && summary && summary.loggedCount > 0 && (
        <>
          <div className="stat-tiles">
            <StatTile label="Days logged" value={`${summary.loggedCount}`} sub={`of ${range}`} />
            <StatTile
              label="Avg calories"
              value={`${summary.avgCalories}`}
              sub={data.targets ? `target ${data.targets.calorie_target}` : "per logged day"}
            />
            {summary.onTarget != null ? (
              <StatTile label="On target" value={`${summary.onTarget}`} sub="±10% of goal" />
            ) : (
              <StatTile
                label="Avg protein"
                value={`${summary.avgProtein}g`}
                sub="per logged day"
              />
            )}
          </div>

          <TrendChart
            title="Calories per day"
            days={data.days}
            value={(d) => d.calories}
            target={data.targets?.calorie_target ?? null}
            unit=""
          />
          <TrendChart
            title="Protein per day"
            days={data.days}
            value={(d) => d.protein_g}
            target={data.targets?.protein_target_g ?? null}
            unit="g"
          />

          {!data.targets && (
            <p className="stats-hint">
              Fill in your profile (height, weight, age, sex, activity, goal) to see your target
              lines here.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value">{value}</span>
      <span className="stat-tile-sub">{sub}</span>
    </div>
  );
}

// Fixed viewBox so the chart scales uniformly to its container regardless of how
// many days are shown; bars just get thinner for longer ranges.
const VBW = 320;
const VBH = 150;
const PAD = { left: 6, right: 6, top: 12, bottom: 18 };
const PLOT_W = VBW - PAD.left - PAD.right;
const PLOT_H = VBH - PAD.top - PAD.bottom;
const BASELINE_Y = PAD.top + PLOT_H;

interface TrendChartProps {
  title: string;
  days: DailyStat[];
  value: (d: DailyStat) => number;
  target: number | null;
  unit: string;
}

function TrendChart({ title, days, value, target, unit }: TrendChartProps) {
  const n = days.length;
  const slot = PLOT_W / n;
  const barW = Math.min(slot * 0.66, 22);
  const maxValue = Math.max(...days.map(value), target ?? 0, 1);
  const yMax = maxValue * 1.12;
  const y = (v: number) => PAD.top + PLOT_H * (1 - v / yMax);

  // Label a handful of days only, so long ranges don't collide: every day for a
  // week, four evenly-spaced otherwise, always including the last (today).
  const labelIdx = new Set<number>();
  if (n <= 8) {
    for (let i = 0; i < n; i++) labelIdx.add(i);
  } else {
    [0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1].forEach((i) =>
      labelIdx.add(i),
    );
  }

  const targetY = target != null ? y(target) : null;

  return (
    <figure className="trend-chart">
      <figcaption>
        {title}
        {target != null && (
          <span className="trend-target-note"> · target {target}{unit}</span>
        )}
      </figcaption>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        className="trend-svg"
        role="img"
        aria-label={`${title}. Daily bars${target != null ? ` against a target of ${target}${unit}` : ""}.`}
      >
        {/* baseline */}
        <line x1={PAD.left} y1={BASELINE_Y} x2={VBW - PAD.right} y2={BASELINE_Y} className="trend-axis" />

        {/* bars */}
        {days.map((d, i) => {
          const v = value(d);
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const barH = d.logged && v > 0 ? Math.max(BASELINE_Y - y(v), 1) : 0;
          const pretty = parseLocalDate(d.date).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          });
          return (
            <g key={d.date}>
              {d.logged ? (
                <rect
                  x={x}
                  y={BASELINE_Y - barH}
                  width={barW}
                  height={barH}
                  rx={2}
                  className="trend-bar"
                >
                  <title>{`${pretty}: ${v}${unit}`}</title>
                </rect>
              ) : (
                // A faint tick marks a day with nothing logged, so a gap reads
                // as "no data" rather than a value of zero.
                <rect
                  x={x}
                  y={BASELINE_Y - 2}
                  width={barW}
                  height={2}
                  rx={1}
                  className="trend-bar-empty"
                >
                  <title>{`${pretty}: nothing logged`}</title>
                </rect>
              )}
            </g>
          );
        })}

        {/* target reference line, drawn over the bars */}
        {targetY != null && (
          <line
            x1={PAD.left}
            y1={targetY}
            x2={VBW - PAD.right}
            y2={targetY}
            className="trend-target-line"
          />
        )}

        {/* date labels */}
        {days.map((d, i) =>
          labelIdx.has(i) ? (
            <text
              key={d.date}
              x={PAD.left + i * slot + slot / 2}
              y={VBH - 5}
              textAnchor="middle"
              className="trend-label"
            >
              {parseLocalDate(d.date).getDate()}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  );
}
