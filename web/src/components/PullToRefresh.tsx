import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";

// Installed as a standalone PWA (manifest.webmanifest: "display": "standalone"),
// this app has no browser chrome — the native pull-to-refresh gesture that
// exists inside a normal browser tab simply doesn't fire here (2026-08-31
// backlog item: "I drag down, expect a refresh, nothing happens"). This
// reimplements the gesture by hand: a downward drag starting at the very
// top of the page reveals a spinner and reloads once pulled far enough,
// mirroring the native iOS/Android feel.
const THRESHOLD_PX = 70;
const MAX_PULL_PX = 110;
const RESISTANCE = 0.5;
const SETTLE_MS = 280;
const RELOAD_DELAY_MS = 550; // > SETTLE_MS, so the glide finishes before the reload cuts in
const SPIN_DEG_PER_MS = 360 / 900; // one continuous turn every 900ms

export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Gates the CSS transition: off while a finger is actively dragging (the
  // dot must track 1:1, with zero lag), on the instant it lifts — so
  // whatever happens next (settle-and-spin, or snap back to hidden) glides
  // smoothly FROM the exact point the finger left it, instead of jumping.
  const [dragging, setDragging] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);
  const iconRef = useRef<SVGSVGElement>(null);
  const spinAngleRef = useRef(0);

  useEffect(() => {
    function handleTouchStart(e: TouchEvent) {
      if (refreshing) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      startYRef.current = scrollTop === 0 ? e.touches[0]!.clientY : null;
      pullingRef.current = false;
    }

    function handleTouchMove(e: TouchEvent) {
      if (startYRef.current == null || refreshing) return;
      const dy = e.touches[0]!.clientY - startYRef.current;
      if (dy <= 0) {
        setDragging(false);
        setPull(0);
        pullingRef.current = false;
        return;
      }
      // Only take over the gesture once it's clearly a downward pull, so an
      // ordinary tap or an upward scroll never gets hijacked mid-gesture.
      pullingRef.current = true;
      setDragging(true);
      e.preventDefault();
      setPull(Math.min(dy * RESISTANCE, MAX_PULL_PX));
    }

    function handleTouchEnd() {
      startYRef.current = null;
      if (!pullingRef.current) return;
      pullingRef.current = false;
      setDragging(false); // enables the glide for whatever setPull does next
      setPull((current) => {
        if (current >= THRESHOLD_PX) {
          // Hand off to the continuous spin at the exact angle the drag left
          // it at — no reset-to-zero jump like swapping in a CSS keyframe
          // (e.g. Tailwind's animate-spin) mid-gesture would cause.
          spinAngleRef.current = current * 3;
          setRefreshing(true);
          window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
          return THRESHOLD_PX;
        }
        return 0;
      });
    }

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [refreshing]);

  // Drag/idle phase: rotation tracks the pull distance directly, applied
  // imperatively (not via a React style prop) so there's a single owner of
  // this transform and handing off to the rAF loop below never fights it.
  useEffect(() => {
    if (refreshing || !iconRef.current) return;
    iconRef.current.style.transform = `rotate(${pull * 3}deg)`;
  }, [pull, refreshing]);

  // Refresh phase: spins continuously starting from spinAngleRef (seeded
  // above at the moment of release), so the hand-off is visually seamless.
  useEffect(() => {
    if (!refreshing) return;
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      spinAngleRef.current += (now - last) * SPIN_DEG_PER_MS;
      last = now;
      if (iconRef.current) iconRef.current.style.transform = `rotate(${spinAngleRef.current}deg)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [refreshing]);

  const visible = pull > 0 || refreshing;
  // Whenever a finger isn't actively moving the dot, transitions are on —
  // covers both "settle into the refreshing position" and "snap back below
  // threshold", so both glide instead of jumping.
  const settleTransition = !dragging;

  return (
    <>
      <div
        className="pointer-events-none fixed left-1/2 top-0 z-[60] flex justify-center"
        style={{
          transform: `translate(-50%, ${pull - 44}px)`,
          opacity: visible ? 1 : 0,
          transition: settleTransition
            ? `transform ${SETTLE_MS}ms cubic-bezier(0.22,1,0.36,1), opacity 200ms ease`
            : undefined,
        }}
      >
        <div className="grid size-9 place-items-center rounded-full bg-white shadow-md ring-1 ring-ink/5">
          <RefreshCw ref={iconRef} className="size-4 text-coral" />
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: settleTransition ? `transform ${SETTLE_MS}ms cubic-bezier(0.22,1,0.36,1)` : undefined,
        }}
      >
        {children}
      </div>
    </>
  );
}
