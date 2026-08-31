import { useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";

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

export function PullToRefresh({ children }: { children: ReactNode }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const pullingRef = useRef(false);

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
        setPull(0);
        pullingRef.current = false;
        return;
      }
      // Only take over the gesture once it's clearly a downward pull, so an
      // ordinary tap or an upward scroll never gets hijacked mid-gesture.
      pullingRef.current = true;
      e.preventDefault();
      setPull(Math.min(dy * RESISTANCE, MAX_PULL_PX));
    }

    function handleTouchEnd() {
      startYRef.current = null;
      if (!pullingRef.current) return;
      pullingRef.current = false;
      setPull((current) => {
        if (current >= THRESHOLD_PX) {
          setRefreshing(true);
          window.setTimeout(() => window.location.reload(), 400);
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

  const visible = pull > 0 || refreshing;

  return (
    <>
      <div
        className="pointer-events-none fixed left-1/2 top-0 z-[60] flex justify-center"
        style={{
          transform: `translate(-50%, ${pull - 44}px)`,
          opacity: visible ? 1 : 0,
          transition: pull === 0 && !refreshing ? "transform 0.25s ease, opacity 0.25s ease" : undefined,
        }}
      >
        <div className="grid size-9 place-items-center rounded-full bg-white shadow-md ring-1 ring-ink/5">
          <RefreshCw
            className={cn("size-4 text-coral", refreshing && "animate-spin")}
            style={!refreshing ? { transform: `rotate(${pull * 3}deg)` } : undefined}
          />
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: pull === 0 ? "transform 0.25s ease" : undefined,
        }}
      >
        {children}
      </div>
    </>
  );
}
