import { useEffect, useState } from "react";
import { fetchMe, getStoredToken, logout as logoutRequest, SESSION_INVALIDATED_EVENT } from "./api/client";
import { AdminCorrectionsPage } from "./components/AdminCorrectionsPage";
import { AdminFeedbackPage } from "./components/AdminFeedbackPage";
import { AdminPanelPage } from "./components/AdminPanelPage";
import { AuthGate } from "./components/AuthGate";
import { BarcodeScanner } from "./components/BarcodeScanner";
import { Dashboard } from "./components/Dashboard";
import { FeedbackPage } from "./components/FeedbackPage";
import { MyFoodsPage } from "./components/MyFoodsPage";
import { HomeScreen } from "./components/HomeScreen";
import { ProfilePage } from "./components/ProfilePage";
import { PullToRefresh } from "./components/PullToRefresh";
import { ProvidersPage } from "./components/ProvidersPage";
import { useConversation, type ConversationApi, type Phase } from "./conversation/useConversation";
import { LanguageProvider } from "./i18n/LanguageContext";
import { useT, type StringKey } from "./i18n/useT";

type View =
  | "home"
  | "dashboard"
  | "profile"
  | "my-foods"
  | "feedback"
  | "admin"
  | "admin-panel"
  | "corrections"
  | "providers"
  | "scan";

// Menu visibility only — the real gate is server-side (ADMIN_USERNAMES on
// /admin/*). Comma-separated to match the server's env var shape.
const ADMIN_USERNAMES = new Set(
  ((import.meta.env["VITE_ADMIN_USERNAME"] as string | undefined) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const PILL_LABEL_KEYS: Partial<Record<Phase, StringKey>> = {
  "awaiting-mic": "app.pillAwaitingMic",
  listening: "app.pillListening",
  thinking: "app.pillThinking",
  speaking: "app.pillSpeaking",
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

  // Warm the greeting as soon as we know we're actually logged in, so the
  // tap that starts a session usually finds it already resolved instead of
  // fetching cold. useConversation() has no auth state of its own, hence
  // triggering this from here rather than inside the hook.
  useEffect(() => {
    if (!authed) return;
    conversation.prefetchGreeting();
    // Deliberately only re-run on an auth transition, not on every render
    // that happens to produce a new prefetchGreeting reference — refetching
    // the greeting on unrelated re-renders would defeat the point of a
    // one-shot prefetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function handleLogout() {
    endSession();
    setView("home");
    setAuthed(false);
    await logoutRequest();
  }

  if (!authed) {
    return (
      <PullToRefresh>
        <AuthGate onAuthed={() => setAuthed(true)} />
      </PullToRefresh>
    );
  }

  const isAdmin = username != null && ADMIN_USERNAMES.has(username.toLowerCase());

  return (
    <LanguageProvider>
      <PullToRefresh>
        <AppShell
          view={view}
          setView={setView}
          conversation={conversation}
          endSession={endSession}
          scanSignal={scanSignal}
          setScanSignal={setScanSignal}
          onLogout={handleLogout}
          isAdmin={isAdmin}
        />
      </PullToRefresh>
    </LanguageProvider>
  );
}

interface AppShellProps {
  view: View;
  setView: (view: View) => void;
  conversation: ConversationApi;
  endSession: () => void;
  scanSignal: number;
  setScanSignal: (updater: (s: number) => number) => void;
  onLogout: () => void;
  isAdmin: boolean;
}

// Split out from App() purely so this can call useT() — it needs to render
// inside <LanguageProvider>, which App() itself renders, so it can't consume
// that same context.
function AppShell({ view, setView, conversation, endSession, scanSignal, setScanSignal, onLogout, isAdmin }: AppShellProps) {
  const t = useT();
  const pillLabelKey = PILL_LABEL_KEYS[conversation.phase];

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
          onLogout={onLogout}
          isAdmin={isAdmin}
        />
      )}
      {view === "scan" && (
        <BarcodeScanner
          log={conversation.addDiagnostic}
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
      {view === "profile" && (
        <ProfilePage onBack={() => setView("home")} onOpenMyFoods={() => setView("my-foods")} />
      )}
      {view === "my-foods" && (
        <MyFoodsPage onBack={() => setView("profile")} onLogged={() => setScanSignal((s) => s + 1)} />
      )}
      {view === "feedback" && (
        <FeedbackPage diagnostics={conversation.diagnostics} onBack={() => setView("home")} />
      )}
      {view === "admin-panel" && (
        <AdminPanelPage
          onBack={() => setView("home")}
          onOpenFeedbackInbox={() => setView("admin")}
          onOpenModelsInUse={() => setView("providers")}
          onOpenCorrections={() => setView("corrections")}
        />
      )}
      {view === "admin" && <AdminFeedbackPage onBack={() => setView("admin-panel")} />}
      {view === "corrections" && <AdminCorrectionsPage onBack={() => setView("admin-panel")} />}
      {view === "providers" && <ProvidersPage onBack={() => setView("admin-panel")} />}

      {pillLabelKey && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink py-2 pl-5 pr-2 shadow-xl">
          <button
            className="flex items-center gap-2 text-sm font-bold text-cream"
            onClick={() => setView("home")}
          >
            <span className="size-2 animate-pulse rounded-full bg-coral" />
            {t(pillLabelKey)}
          </button>
          <button
            className="grid size-8 place-items-center rounded-full bg-white/10 text-cream transition-colors hover:bg-white/20"
            onClick={conversation.endSession}
            aria-label={t("app.endConversation")}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
