import { useState } from "react";

export type MenuView = "dashboard" | "profile" | "diagnostics" | "feedback" | "admin";

interface HamburgerMenuProps {
  onNavigate: (view: MenuView) => void;
  onLogout: () => void;
  isAdmin?: boolean;
}

const ITEMS = [
  { to: "dashboard", label: "Dashboard" },
  { to: "profile", label: "Profile" },
  { to: "diagnostics", label: "Diagnostics" },
  { to: "feedback", label: "Send feedback" },
] as const;

export function HamburgerMenu({ onNavigate, onLogout, isAdmin }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);

  function go(to: MenuView) {
    setOpen(false);
    onNavigate(to);
  }

  function handleLogout() {
    setOpen(false);
    onLogout();
  }

  return (
    <div className="relative">
      <button
        className="grid size-11 place-items-center rounded-2xl bg-white shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <span className="w-5 space-y-1.5">
          <span className="block h-[3px] rounded-full bg-ink/60" />
          <span className="block h-[3px] rounded-full bg-ink/60" />
          <span className="block h-[3px] rounded-full bg-ink/60" />
        </span>
      </button>
      {open && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-14 z-50 w-48 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-ink/5">
            {ITEMS.map((item) => (
              <button
                key={item.to}
                className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-ink transition-colors hover:bg-ink3"
                onClick={() => go(item.to)}
              >
                {item.label}
              </button>
            ))}
            {isAdmin && (
              <button
                className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-ink transition-colors hover:bg-ink3"
                onClick={() => go("admin")}
              >
                Feedback inbox
              </button>
            )}
            <button
              className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-coral transition-colors hover:bg-coral/10"
              onClick={handleLogout}
            >
              Log out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
