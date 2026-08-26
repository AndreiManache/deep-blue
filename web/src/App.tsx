import { useEffect, useState } from "react";
import { getStoredToken, logout as logoutRequest, SESSION_INVALIDATED_EVENT } from "./api/client";
import { AuthGate } from "./components/AuthGate";
import { Dashboard } from "./components/Dashboard";
import { DiagnosticsPage } from "./components/DiagnosticsPage";
import { HomeScreen } from "./components/HomeScreen";
import { ProfilePage } from "./components/ProfilePage";
import { useConversation, type Phase } from "./conversation/useConversation";

type View = "home" | "dashboard" | "profile" | "diagnostics";

const PILL_LABELS: Partial<Record<Phase, string>> = {
  "awaiting-mic": "Allow mic…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function App() {
  const [view, setView] = useState<View>("home");
  // Authed purely by whether a session token is stored. A stale/expired token
  // is caught the first time an API call 401s (see the invalidated event
  // below), which clears it and flips this back to the login screen.
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getStoredToken()));
  const conversation = useConversation();
  const { endSession } = conversation;

  useEffect(() => {
    function handleInvalidated() {
      // The login screen replaces the whole UI — a conversation left running
      // would keep speaking and listening invisibly behind it.
      endSession();
      setAuthed(false);
    }
    window.addEventListener(SESSION_INVALIDATED_EVENT, handleInvalidated);
    return () => window.removeEventListener(SESSION_INVALIDATED_EVENT, handleInvalidated);
    // endSession is a stable-enough plain function recreated per render;
    // re-subscribing on each render is harmless and keeps it current.
  }, [endSession]);

  async function handleLogout() {
    endSession();
    setView("home");
    setAuthed(false);
    await logoutRequest();
  }

  if (!authed) {
    return (
      <div className="app-shell">
        <AuthGate onAuthed={() => setAuthed(true)} />
      </div>
    );
  }

  const pillLabel = PILL_LABELS[conversation.phase];

  return (
    <div className="app-shell">
      {view === "home" && (
        <HomeScreen conversation={conversation} onNavigate={setView} onLogout={handleLogout} />
      )}
      {view === "dashboard" && (
        <Dashboard onBack={() => setView("home")} refreshSignal={conversation.mutationSignal} />
      )}
      {view === "profile" && <ProfilePage onBack={() => setView("home")} />}
      {view === "diagnostics" && (
        <DiagnosticsPage
          events={conversation.diagnostics}
          onClear={conversation.clearDiagnostics}
          onBack={() => setView("home")}
        />
      )}

      {view !== "home" && pillLabel && (
        <div className="conversation-pill">
          <button className="conversation-pill-status" onClick={() => setView("home")}>
            {pillLabel}
          </button>
          <button
            className="conversation-pill-end"
            onClick={conversation.endSession}
            aria-label="End conversation"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
