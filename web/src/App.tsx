import { useEffect, useState } from "react";
import { ACCESS_CODE_INVALIDATED_EVENT } from "./api/client";
import { AccessGate } from "./components/AccessGate";
import { Dashboard } from "./components/Dashboard";
import { HomeScreen } from "./components/HomeScreen";
import { ProfilePage } from "./components/ProfilePage";
import { useConversation } from "./conversation/useConversation";

type View = "home" | "dashboard" | "profile";

export function App() {
  const [view, setView] = useState<View>("home");
  // Starts unlocked, optimistically — in local dev (no ACCESS_CODE
  // configured server-side) no request ever 401s, so the gate never
  // appears. In production it flips true the first time one does.
  const [locked, setLocked] = useState(false);
  const conversation = useConversation();

  useEffect(() => {
    function handleInvalidated() {
      setLocked(true);
    }
    window.addEventListener(ACCESS_CODE_INVALIDATED_EVENT, handleInvalidated);
    return () => window.removeEventListener(ACCESS_CODE_INVALIDATED_EVENT, handleInvalidated);
  }, []);

  if (locked) {
    return (
      <div className="app-shell">
        <AccessGate onUnlock={() => setLocked(false)} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      {view === "home" && <HomeScreen conversation={conversation} onNavigate={setView} />}
      {view === "dashboard" && (
        <Dashboard onBack={() => setView("home")} refreshSignal={conversation.mutationSignal} />
      )}
      {view === "profile" && <ProfilePage onBack={() => setView("home")} />}
    </div>
  );
}
