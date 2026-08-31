import { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import { useT } from "../i18n/useT";

export type MenuView = "dashboard" | "profile" | "feedback" | "admin-panel";

interface HamburgerMenuProps {
  onNavigate: (view: MenuView) => void;
  onLogout: () => void;
}

export function HamburgerMenu({ onNavigate, onLogout }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const { language } = useLanguage();
  const t = useT();
  // "Dashboard" doesn't read as "this is your food log" to a Romanian
  // speaker (feedback, 2026-08-29) — the fix is a per-language label, not a
  // permanent rename, since English users still want the English word.
  const items = [
    { to: "dashboard" as const, label: language === "ro" ? "Jurnal alimentar" : "Dashboard" },
    { to: "profile" as const, label: t("menu.profile") },
    { to: "feedback" as const, label: t("menu.sendFeedback") },
  ];

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
        aria-label={t("menu.open")}
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
            aria-label={t("menu.close")}
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-14 z-50 w-48 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-ink/5">
            {items.map((item) => (
              <button
                key={item.to}
                className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-ink transition-colors hover:bg-ink3"
                onClick={() => go(item.to)}
              >
                {item.label}
              </button>
            ))}
            <button
              className="block w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-coral transition-colors hover:bg-coral/10"
              onClick={handleLogout}
            >
              {t("menu.logOut")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
