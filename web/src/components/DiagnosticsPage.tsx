import { useState } from "react";
import type { DiagEvent } from "../conversation/useConversation";

interface DiagnosticsPageProps {
  events: DiagEvent[];
  onClear: () => void;
  onBack: () => void;
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleTimeString(undefined, { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function DiagnosticsPage({ events, onClear, onBack }: DiagnosticsPageProps) {
  const [copied, setCopied] = useState(false);

  function toText(): string {
    return events
      .map((e, i) => {
        const delta = i === 0 ? 0 : e.t - events[i - 1].t;
        return `${fmtTime(e.t)}  +${delta}ms  ${e.label}${e.detail ? `: ${e.detail}` : ""}`;
      })
      .join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(toText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the on-screen list is still screenshot-able */
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <button className="back-button" onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className="dashboard-title">
          <h1>Diagnostics</h1>
          <p>Speech &amp; latency log — newest at the bottom</p>
        </div>
      </div>

      <div className="diag-actions">
        <button className="pill-button" onClick={copy} disabled={events.length === 0}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="pill-button danger" onClick={onClear} disabled={events.length === 0}>
          Clear
        </button>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          Nothing logged yet. Start a conversation, then come back here to see exactly what the mic
          heard and how long each reply took.
        </div>
      ) : (
        <ol className="diag-list">
          {events.map((e, i) => {
            const delta = i === 0 ? 0 : e.t - events[i - 1].t;
            const slow = delta >= 2000;
            return (
              <li key={i} className="diag-row">
                <span className="diag-time">{fmtTime(e.t)}</span>
                <span className={slow ? "diag-delta slow" : "diag-delta"}>+{delta}ms</span>
                <span className="diag-label">
                  {e.label}
                  {e.detail ? <span className="diag-detail"> {e.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
