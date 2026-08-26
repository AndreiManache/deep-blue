import { useState } from "react";

interface HamburgerMenuProps {
  onNavigate: (view: "dashboard" | "profile") => void;
  onLogout: () => void;
}

export function HamburgerMenu({ onNavigate, onLogout }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);

  function go(view: "dashboard" | "profile") {
    setOpen(false);
    onNavigate(view);
  }

  function handleLogout() {
    setOpen(false);
    onLogout();
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
          <button className="dropdown-item dropdown-item-danger" onClick={handleLogout}>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
