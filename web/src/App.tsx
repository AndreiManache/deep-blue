import { useEffect, useState } from "react";
import { fetchMe, getStoredToken, logout as logoutRequest, SESSION_INVALIDATED_EVENT } from "./api/client";
import { AdminFeedbackPage } from "./components/AdminFeedbackPage";
import { AuthGate } from "./components/AuthGate";
import { BarcodeScanner } from "./components/BarcodeScanner";
import { Dashboard } from "./components/Dashboard";
import { DiagnosticsPage } from "./components/DiagnosticsPage";
import { FeedbackPage } from "./components/FeedbackPage";
import { HomeScreen } from "./components/HomeScreen";
import { ProfilePage } from "./components/ProfilePage";
import { useConversation, type Phase } from "./conversation/useConversation";

type View = "home" | "dashboard" | "profile" | "diagnostics" | "feedback" | "admin" | "scan";

// Menu visibility only — the real gate is server-side (ADMIN_USERNAMES on
// /admin/*). Comma-separated to match the server's env var shape.
const ADMIN_USERNAMES = new Set(
  ((import.meta.env["VITE_ADMIN_USERNAME"] as string | undefined) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

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
  const [username, setUsername] = useState<string | null>(null);
  // Barcode logging happens outside useConversation (no Claude turn, so
  // conversation.mutationSignal never bumps) — this stands in for it so the
  // Dashboard still refetches after a scan.
  const [scanSignal, setScanSignal] = useState(0);
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

  // Only needed to decide whether to show the admin menu item — harmless to
  // skip on failure, the menu item just stays hidden.
  useEffect(() => {
    if (!authed) return;
    fetchMe()
      .then((res) => setUsername(res.username))
      .catch(() => {});
  }, [authed]);

  async function handleLogout() {
    endSession();
    setView("home");
    setAuthed(false);
    await logoutRequest();
  }

  if (!authed) {
    return <AuthGate onAuthed={() => setAuthed(true)} />;
  }

  const pillLabel = PILL_LABELS[conversation.phase];
  const isAdmin = username != null && ADMIN_USERNAMES.has(username.toLowerCase());

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col">
      {view === "home" && (
        <HomeScreen
          conversation={conversation}
          onNavigate={setView}
          onScan={() => {
            // A live session keeps the mic held and speak() running behind
            // other views — end it before competing with the camera for
            // device access, an iOS pain point this app has history with.
            endSession();
            setView("scan");
          }}
          onLogout={handleLogout}
          isAdmin={isAdmin}
        />
      )}
      {view === "scan" && (
        <BarcodeScanner
          onDone={() => {
            setScanSignal((s) => s + 1);
            setView("home");
          }}
        />
      )}
      {view === "dashboard" && (
        <Dashboard
          onBack={() => setView("home")}
          refreshSignal={conversation.mutationSignal + scanSignal}
        />
      )}
      {view === "profile" && <ProfilePage onBack={() => setView("home")} />}
      {view === "diagnostics" && (
        <DiagnosticsPage
          events={conversation.diagnostics}
          onClear={conversation.clearDiagnostics}
          onBack={() => setView("home")}
        />
      )}
      {view === "feedback" && (
        <FeedbackPage diagnostics={conversation.diagnostics} onBack={() => setView("home")} />
      )}
      {view === "admin" && <AdminFeedbackPage onBack={() => setView("home")} />}

      {view !== "home" && pillLabel && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink py-2 pl-5 pr-2 shadow-xl">
          <button
            className="flex items-center gap-2 text-sm font-bold text-cream"
            onClick={() => setView("home")}
          >
            <span className="size-2 animate-pulse rounded-full bg-coral" />
            {pillLabel}
          </button>
          <button
            className="grid size-8 place-items-center rounded-full bg-white/10 text-cream transition-colors hover:bg-white/20"
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
