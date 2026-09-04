import { useEffect, useRef, useState, type ReactNode, type TouchEvent as ReactTouchEvent } from "react";
import { X } from "lucide-react";

interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
}

const TRANSITION_MS = 200;
// How far the header must be dragged down before release counts as "close",
// rather than snapping back open.
const DISMISS_DRAG_PX = 70;

// Shared modal shell for "tap a list item to see its full details"
// (2026-09-04) — first used for Dashboard food entries and feedback reports,
// so it deliberately carries no domain content itself, just the open/close
// mechanics: backdrop fade, a centered card that fades+scales in (per the
// user's own sketch — a floating window in the middle of the screen, not a
// sheet anchored to an edge), closable via backdrop tap, Escape, the X, or
// dragging the header down.
export function DetailSheet({ open, onClose, title, closeLabel, children }: DetailSheetProps) {
  // Stays mounted slightly after `open` goes false, so the closing
  // transition gets to play instead of the modal just vanishing.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  // Live drag offset while dragging the header down to dismiss.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame, so the transition animates from the start state instead
      // of snapping straight to the open state.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    setDragY(0);
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mounted, onClose]);

  // Locks the background page while the modal is up (2026-09-04 — the page
  // underneath was still fully scrollable/touchable behind the overlay: a
  // downward drag anywhere fell through to the app's own pull-to-refresh,
  // and on iOS the fixed backdrop visibly lagged covering the status-bar
  // strip because the page below kept participating in the scroll/rubber-
  // band pipeline). `overflow: hidden` alone doesn't stop iOS Safari's touch
  // scrolling — this is the standard fixed-position-body trick, restoring
  // the exact scroll position on close.
  useEffect(() => {
    if (!mounted) return;
    const scrollY = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [mounted]);

  // Every touch anywhere in the modal stops here — it never reaches the
  // `window`-level listeners PullToRefresh installs, so a drag inside the
  // modal can no longer trigger the background page's pull-to-refresh.
  // stopPropagation only blocks bubbling, not the browser's own default
  // touch-scroll behavior, so the sheet body's own overflow-y-auto scrolling
  // is completely unaffected.
  const stop = (e: ReactTouchEvent) => e.stopPropagation();

  function handleHeaderTouchStart(e: ReactTouchEvent) {
    e.stopPropagation();
    dragStartYRef.current = e.touches[0]!.clientY;
  }

  function handleHeaderTouchMove(e: ReactTouchEvent) {
    e.stopPropagation();
    if (dragStartYRef.current == null) return;
    const dy = e.touches[0]!.clientY - dragStartYRef.current;
    if (dy <= 0) {
      setDragging(false);
      setDragY(0);
      return;
    }
    setDragging(true);
    setDragY(dy);
  }

  function handleHeaderTouchEnd(e: ReactTouchEvent) {
    e.stopPropagation();
    dragStartYRef.current = null;
    setDragging(false);
    if (dragY > DISMISS_DRAG_PX) {
      onClose();
    } else {
      setDragY(0);
    }
  }

  if (!mounted) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-5"
      role="dialog"
      aria-modal="true"
      onTouchStart={stop}
      onTouchMove={stop}
      onTouchEnd={stop}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${TRANSITION_MS}ms ease` }}
        onClick={onClose}
      />
      <div
        className="relative flex max-h-[80dvh] w-full max-w-[380px] flex-col overflow-hidden rounded-[2rem] bg-white shadow-xl"
        style={{
          opacity: visible ? 1 : 0,
          transform: `scale(${visible ? 1 : 0.94}) translateY(${dragY}px)`,
          transition: dragging
            ? "none"
            : `transform ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${TRANSITION_MS}ms ease`,
        }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b border-ink/5 px-6 py-4"
          onTouchStart={handleHeaderTouchStart}
          onTouchMove={handleHeaderTouchMove}
          onTouchEnd={handleHeaderTouchEnd}
        >
          <div className="min-w-0 flex-1">{title}</div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink3 text-ink/60 transition-colors hover:bg-ink/10"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
