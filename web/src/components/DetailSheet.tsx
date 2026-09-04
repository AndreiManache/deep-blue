import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
}

const TRANSITION_MS = 200;
// How far the card must be dragged down before release counts as "close",
// rather than snapping back open.
const DISMISS_DRAG_PX = 70;

// Shared modal shell for "tap a list item to see its full details"
// (2026-09-04) — first used for Dashboard food entries and feedback reports,
// so it deliberately carries no domain content itself, just the open/close
// mechanics: backdrop fade, a centered card that fades+scales in (per the
// user's own sketch — a floating window in the middle of the screen, not a
// sheet anchored to an edge), closable via backdrop tap, Escape, the X, or
// dragging the card down from anywhere on it.
export function DetailSheet({ open, onClose, title, closeLabel, children }: DetailSheetProps) {
  // Stays mounted slightly after `open` goes false, so the closing
  // transition gets to play instead of the modal just vanishing.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  // Live drag offset while dragging the card down to dismiss.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    setVisible(false);
    setDragY(0);
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  // Reveals the modal once it's actually in the DOM (a separate effect from
  // the one above — `wrapperRef` doesn't exist yet on the same pass that
  // calls setMounted(true), only on the next commit after it). Reading
  // offsetHeight first forces a synchronous layout: iOS Safari has a known
  // bug where a `position: fixed` element inserted via JS (no accompanying
  // scroll/gesture) doesn't immediately extend its paint over the safe-area
  // strip at the very top of the screen, visibly catching up a beat later;
  // forcing layout before the paint that makes it visible closes that gap.
  useEffect(() => {
    if (!mounted) return;
    wrapperRef.current?.offsetHeight;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

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

  // Touch handling on the card, as plain DOM listeners rather than React's
  // onTouch* props — React attaches touchstart/touchmove as PASSIVE by
  // default, which silently no-ops preventDefault() (see PullToRefresh.tsx,
  // which hit this same issue first). We need a real preventDefault once a
  // dismiss-drag is claimed, to stop iOS's native rubber-band bounce while
  // the card is following the finger instead.
  //
  // Dismiss-drag starts from ANYWHERE on the card (header or body) — not
  // just the header. The body's own overflow-y-auto scrolling is left
  // completely alone UNLESS the body is already scrolled to its top and the
  // drag continues downward from there; only then does this claim the
  // gesture. Every touch on the card also stops propagation, regardless of
  // whether it becomes a dismiss-drag, so it never reaches the `window`-
  // level listeners PullToRefresh installs — a drag inside the modal can no
  // longer trigger the background page's pull-to-refresh.
  useEffect(() => {
    const card = cardRef.current;
    if (!mounted || !card) return;

    let startY: number | null = null;
    let engaged = false;
    let liveDragY = 0;

    function handleTouchStart(e: TouchEvent) {
      e.stopPropagation();
      startY = e.touches[0]!.clientY;
      engaged = false;
    }

    function handleTouchMove(e: TouchEvent) {
      e.stopPropagation();
      if (startY == null) return;
      const dy = e.touches[0]!.clientY - startY;

      if (!engaged) {
        const atTop = (bodyRef.current?.scrollTop ?? 0) <= 0;
        if (dy > 0 && atTop) {
          engaged = true;
        } else {
          return; // let the body scroll normally
        }
      }

      e.preventDefault();
      liveDragY = Math.max(0, dy);
      setDragging(true);
      setDragY(liveDragY);
    }

    function handleTouchEnd(e: TouchEvent) {
      e.stopPropagation();
      startY = null;
      const wasEngaged = engaged;
      engaged = false;
      setDragging(false);
      if (wasEngaged && liveDragY > DISMISS_DRAG_PX) {
        onClose();
      } else {
        setDragY(0);
      }
      liveDragY = 0;
    }

    card.addEventListener("touchstart", handleTouchStart, { passive: true });
    card.addEventListener("touchmove", handleTouchMove, { passive: false });
    card.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      card.removeEventListener("touchstart", handleTouchStart);
      card.removeEventListener("touchmove", handleTouchMove);
      card.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  return (
    <div
      ref={wrapperRef}
      className="fixed inset-0 z-[70] flex h-dvh w-screen items-center justify-center p-5"
      style={{ willChange: "opacity" }}
      role="dialog"
      aria-modal="true"
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-ink/40"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${TRANSITION_MS}ms ease` }}
        onClick={onClose}
      />
      <div
        ref={cardRef}
        className="relative flex max-h-[80dvh] w-full max-w-[380px] flex-col overflow-hidden rounded-[2rem] bg-white shadow-xl"
        style={{
          opacity: visible ? 1 : 0,
          transform: `scale(${visible ? 1 : 0.94}) translateY(${dragY}px)`,
          transition: dragging
            ? "none"
            : `transform ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1), opacity ${TRANSITION_MS}ms ease`,
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink/5 px-6 py-4">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink3 text-ink/60 transition-colors hover:bg-ink/10"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </button>
        </div>
        <div ref={bodyRef} className="overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
