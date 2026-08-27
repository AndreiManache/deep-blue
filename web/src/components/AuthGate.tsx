import { useState } from "react";
import { ApiError, loginAccount, registerAccount } from "../api/client";
import { Logo } from "./Logo";

interface AuthGateProps {
  onAuthed: (username: string) => void;
}

type Mode = "login" | "register";

const inputClass =
  "w-full rounded-2xl bg-white px-4 py-4 text-sm font-semibold text-ink shadow-sm ring-1 ring-ink/5 outline-none placeholder:font-medium placeholder:text-ink/30 focus:ring-2 focus:ring-coral/50";

export function AuthGate({ onAuthed }: AuthGateProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("Enter a username and password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const call = mode === "login" ? loginAccount : registerAccount;
      const result = await call(username.trim(), password);
      onAuthed(result.username);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const isLogin = mode === "login";

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <form
        className="w-full max-w-sm rounded-[2rem] bg-white p-7 shadow-sm ring-1 ring-ink/5"
        onSubmit={handleSubmit}
      >
        <div className="grid size-12 place-items-center rounded-2xl bg-coral/10">
          <Logo className="size-7" title="Deep Blue" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink">
          {isLogin ? "Log in" : "Create account"}
        </h1>

        <p className="mt-1 text-sm font-medium text-ink/50">
          {isLogin
            ? "Welcome back to Deep Blue. Log in to continue."
            : "Pick a username and password to get started with Deep Blue."}
        </p>

        <div className="mt-6 space-y-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
            className={inputClass}
            aria-label="Username"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            className={inputClass}
            aria-label="Password"
          />
        </div>

        {error && (
          <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-semibold text-coral ring-1 ring-coral/20">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="mt-6 w-full rounded-2xl bg-coral py-4 text-sm font-bold text-white shadow-lg shadow-coral/40 transition-transform active:scale-[0.98] disabled:opacity-60"
          disabled={busy}
        >
          {busy ? "One moment…" : isLogin ? "Log in" : "Sign up"}
        </button>

        <p className="mt-5 text-center text-sm font-medium text-ink/50">
          {isLogin ? "New here? " : "Already have an account? "}
          <button
            type="button"
            className="font-bold text-coral"
            onClick={() => switchMode(isLogin ? "register" : "login")}
          >
            {isLogin ? "Create an account" : "Log in"}
          </button>
        </p>
      </form>
    </div>
  );
}
