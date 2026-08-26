import { useState } from "react";
import { ApiError, loginAccount, registerAccount } from "../api/client";

interface AuthGateProps {
  onAuthed: (username: string) => void;
}

type Mode = "login" | "register";

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
    <div className="unsupported-screen">
      <form className="mic-permission-help access-gate-form" onSubmit={handleSubmit}>
        <h2>{isLogin ? "Log in" : "Create account"}</h2>
        <p>
          {isLogin
            ? "Welcome back to Deep Blue. Log in to continue."
            : "Pick a username and password to get started with Deep Blue."}
        </p>

        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          autoFocus
          className="access-code-input"
          aria-label="Username"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          className="access-code-input"
          aria-label="Password"
        />

        {error && <p className="auth-error">{error}</p>}

        <button type="submit" className="pill-button" disabled={busy}>
          {busy ? "One moment…" : isLogin ? "Log in" : "Sign up"}
        </button>

        <p className="auth-switch">
          {isLogin ? "New here? " : "Already have an account? "}
          <button
            type="button"
            className="auth-switch-link"
            onClick={() => switchMode(isLogin ? "register" : "login")}
          >
            {isLogin ? "Create an account" : "Log in"}
          </button>
        </p>
      </form>
    </div>
  );
}
