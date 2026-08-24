import { useState } from "react";
import { setStoredAccessCode } from "../api/client";

interface AccessGateProps {
  onUnlock: () => void;
}

export function AccessGate({ onUnlock }: AccessGateProps) {
  const [code, setCode] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setStoredAccessCode(code.trim());
    onUnlock();
  }

  return (
    <div className="unsupported-screen">
      <form className="mic-permission-help access-gate-form" onSubmit={handleSubmit}>
        <h2>Enter access code</h2>
        <p>Deep Blue is private. Enter your access code to continue.</p>
        <input
          type="password"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          className="access-code-input"
        />
        <button type="submit" className="pill-button">
          Continue
        </button>
      </form>
    </div>
  );
}
