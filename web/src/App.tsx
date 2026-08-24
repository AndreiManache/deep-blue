import { useEffect, useState } from "react";
import { ACCESS_CODE_INVALIDATED_EVENT } from "./api/client";
import { AccessGate } from "./components/AccessGate";
import { Dashboard } from "./components/Dashboard";
import { HomeScreen } from "./components/HomeScreen";
import { ProfilePage } from "./components/ProfilePage";
import { useConversation, type Phase } from "./conversation/useConversation";

type View = "home" | "dashboard" | "profile";

const PILL_LABELS: Partial<Record<Phase, string>> = {
  "awaiting-mic": "Allow mic…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

export function App() {
  const [view, setView] = useState<View>("home");
  // Starts unlocked, optimistically — in local dev (no ACCESS_CODE
  // configured server-side) no request ever 401s, so the gate never
  // appears. In production it flips true the first time one does.
  const [locked, setLocked] = useState(false);
  const conversation = useConversation();
  const { endSession } = conversation;

  useEffect(() => {
    function handleInvalidated() {
      // The gate replaces the whole UI — a conversation left running would
      // keep speaking and listening invisibly behind it.
      endSession();
      setLocked(true);
    }
    window.addEventListener(ACCESS_CODE_INVALIDATED_EVENT, handleInvalidated);
    return () => window.removeEventListener(ACCESS_CODE_INVALIDATED_EVENT, handleInvalidated);
    // endSession is a stable-enough plain function recreated per render;
    // re-subscribing on each render is harmless and keeps it current.
  }, [endSession]);

  if (locked) {
    return (
      <div className="app-shell">
        <AccessGate onUnlock={() => setLocked(false)} />
      </div>
    );
  }

  const pillLabel = PILL_LABELS[conversation.phase];

  return (
    <div className="app-shell">
      {view === "home" && <HomeScreen conversation={conversation} onNavigate={setView} />}
      {view === "dashboard" && (
        <Dashboard onBack={() => setView("home")} refreshSignal={conversation.mutationSignal} />
      )}
      {view === "profile" && <ProfilePage onBack={() => setView("home")} />}

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
