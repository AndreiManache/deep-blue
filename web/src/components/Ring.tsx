import type { ReactNode } from "react";

interface RingProps {
  size: number;
  stroke: number;
  pct: number; // 0..1, clamped
  over?: boolean; // paint the reserved danger color when the target is exceeded
  children?: ReactNode; // centered content (value / label)
}

// A circular progress meter. The center content is an HTML overlay (not SVG
// <text>) so it inherits the app's type tokens and stays crisp at any size.
export function Ring({ size, stroke, pct, over, children }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  const offset = c * (1 - clamped);
  const center = size / 2;

  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle cx={center} cy={center} r={r} fill="none" className="ring-track" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          className={over ? "ring-fill over" : "ring-fill"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </svg>
      {children != null && <div className="ring-center">{children}</div>}
    </div>
  );
}
