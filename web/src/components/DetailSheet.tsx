import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface DetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  closeLabel: string;
  children: ReactNode;
}

const TRANSITION_MS = 250;

// Shared bottom-sheet shell for "tap a list item to see its full details"
// (2026-09-04) — first used for Dashboard food entries and feedback reports,
// so it deliberately carries no domain content itself, just the open/close
// mechanics: backdrop fade, slide-up sheet, tap-backdrop/Escape/X to close.
export function DetailSheet({ open, onClose, title, closeLabel, children }: DetailSheetProps) {
  // Stays mounted slightly after `open` goes false, so the closing
  // transition gets to play instead of the sheet just vanishing.
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame, so the transition animates from the off-screen starting
      // position instead of snapping straight to the open state.
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
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

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/40"
        style={{ opacity: visible ? 1 : 0, transition: `opacity ${TRANSITION_MS}ms ease` }}
        onClick={onClose}
      />
      <div
        className="relative max-h-[85dvh] w-full max-w-[430px] overflow-y-auto rounded-t-[2rem] bg-white shadow-xl"
        style={{
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${TRANSITION_MS}ms cubic-bezier(0.22,1,0.36,1)`,
        }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-ink/5 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="min-w-0 flex-1">{title}</div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-full bg-ink3 text-ink/60 transition-colors hover:bg-ink/10"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
