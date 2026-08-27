/**
 * Deep Blue brand mark — "The Ink Dot".
 *
 * Semantic contrast: the name reads cold, submerged, machine-like; the mark
 * answers with a single quiet point. One perfect circle on a 64 grid, filled
 * with warm Ink. Nothing else. The warmth lives in the voice orb, not the logo.
 */

/** The mark is a perfect circle, r=24, centred on a 64×64 grid. */
export const MARK_RADIUS = 24;
export const MARK_CX = 32;
export const MARK_CY = 32;

type Tone = "brand" | "ink" | "light";

export function Logo({
  className = "size-9",
  tone = "brand",
  title,
}: {
  className?: string;
  tone?: Tone;
  title?: string;
}) {
  const fill = tone === "light" ? "var(--cream)" : "var(--ink)";

  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx={MARK_CX} cy={MARK_CY} r={MARK_RADIUS} fill={fill} />
    </svg>
  );
}

/** Horizontal lockup: mark + wordmark. */
export function Wordmark({
  className = "",
  tone = "brand",
}: {
  className?: string;
  tone?: Tone;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logo className="size-7" tone={tone} title="Deep Blue" />
      <span
        className={`font-display text-lg font-bold lowercase tracking-tight ${
          tone === "light" ? "text-cream" : "text-ink"
        }`}
      >
        deep&nbsp;blue
      </span>
    </div>
  );
}
