import { useState } from "react";

interface HamburgerMenuProps {
  onNavigate: (view: "dashboard" | "profile") => void;
}

export function HamburgerMenu({ onNavigate }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);

  function go(view: "dashboard" | "profile") {
    setOpen(false);
    onNavigate(view);
  }

  return (
    <div className="hamburger-wrap">
      <button
        className="hamburger-button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open menu"
        aria-expanded={open}
      >
        <span />
        <span />
        <span />
      </button>
      {open && (
        <div className="hamburger-dropdown">
          <button className="dropdown-item" onClick={() => go("dashboard")}>
            Dashboard
          </button>
          <button className="dropdown-item" onClick={() => go("profile")}>
            Profile
          </button>
        </div>
      )}
    </div>
  );
}
