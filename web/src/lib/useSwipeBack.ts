import { useEffect, useRef } from "react";

// Edge-swipe back, the iOS convention: the touch has to START within this
// many px of the left screen edge — that's what tells it apart from an
// ordinary horizontal scroll/drag happening anywhere else on the page (the
// WeekStrip's day picker, dragging text, etc.), so this never has to guess
// at which gesture the user meant.
const EDGE_ZONE_PX = 40;
const MIN_DISTANCE_PX = 60;
const MAX_VERTICAL_DRIFT_PX = 50;

export function useSwipeBack(onBack: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function handleTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      startRef.current = t.clientX <= EDGE_ZONE_PX ? { x: t.clientX, y: t.clientY } : null;
    }
    function handleTouchEnd(e: TouchEvent) {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dx > MIN_DISTANCE_PX && dy < MAX_VERTICAL_DRIFT_PX) onBack();
    }
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [onBack]);
}
