import type { ReactNode } from "react";

interface RingProps {
  size: number;
  stroke: number;
  pct: number; // 0..1, clamped
  over?: boolean; // paint coral when the target is exceeded
  color?: string; // CSS color for the fill arc (defaults to coral)
  trackColor?: string;
  children?: ReactNode; // centered content (value / label)
}

// A circular progress meter. The center content is an HTML overlay (not SVG
// <text>) so it inherits the app's type tokens and stays crisp at any size.
export function Ring({ size, stroke, pct, over, color, trackColor, children }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const offset = c * (1 - clamped);
  const center = size / 2;
  const fill = over ? "var(--color-coral)" : (color ?? "var(--color-coral)");

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={trackColor ?? "var(--ring-track)"}
          strokeWidth={stroke}
        />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={fill}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 grid place-items-center">{children}</div>
      )}
    </div>
  );
}
