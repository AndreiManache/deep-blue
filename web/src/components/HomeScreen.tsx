import { ScanBarcode } from "lucide-react";
import type { ConversationApi, Phase } from "../conversation/useConversation";
import { ErrorBanner } from "./ErrorBanner";
import { Greeting } from "./Greeting";
import { HamburgerMenu, type MenuView } from "./HamburgerMenu";
import { Logo } from "./Logo";
import { MicPermissionHelp } from "./MicPermissionHelp";
import { PhotoAttach } from "./PhotoAttach";
import { TalkButton } from "./TalkButton";

interface HomeScreenProps {
  conversation: ConversationApi;
  onNavigate: (view: MenuView) => void;
  onScan: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
}

const HINTS: Partial<Record<Phase, string>> = {
  "awaiting-mic": "Tap “Allow” when your browser asks for the microphone.",
  listening: "I'm listening — tell me what you ate.",
  thinking: "One moment…",
  speaking: "Talking — tap anytime to cut in.",
};

export function HomeScreen({ conversation, onNavigate, onScan, onLogout, isAdmin }: HomeScreenProps) {
  const {
    phase,
    errorMessage,
    micPermissionDenied,
    startSession,
    endTurn,
    interrupt,
    endSession,
    pendingImage,
    attachImage,
    clearImage,
  } = conversation;

  function handleTap() {
    if (phase === "idle") {
      startSession();
    } else if (phase === "listening") {
      endTurn();
    } else if (phase === "speaking") {
      interrupt(); // barge-in: cut the reply short and listen
    } else if (phase === "awaiting-mic" || phase === "thinking") {
      endSession();
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-6 pb-10 pt-5">
      <header className="flex items-center justify-between">
        <HamburgerMenu onNavigate={onNavigate} onLogout={onLogout} isAdmin={isAdmin} />
        <div className="flex items-center gap-2.5">
          <div className="font-display text-lg font-bold lowercase tracking-tight text-ink">
            deep blue
          </div>
          <Logo className="size-8" title="Deep Blue" />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8 py-8">
        {phase === "unsupported" ? (
          <div className="w-full max-w-sm rounded-[2rem] bg-white p-7 shadow-sm ring-1 ring-ink/5">
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
              Voice isn't supported here
            </h1>
            <p className="mt-2 text-sm font-medium text-ink/60">
              Deep Blue needs a browser with microphone recording and audio playback. Try the
              latest Safari (iOS) or Chrome (Android/desktop).
            </p>
          </div>
        ) : micPermissionDenied ? (
          <div className="w-full max-w-sm">
            <MicPermissionHelp onRetry={startSession} />
          </div>
        ) : (
          <>
            <Greeting />
            <TalkButton phase={phase} onTap={handleTap} />
            <div className="flex items-center justify-center gap-4">
              <PhotoAttach image={pendingImage} onAttach={attachImage} onClear={clearImage} />
              {!pendingImage && (
                <button
                  className="grid size-14 place-items-center rounded-full bg-white text-ink/70 shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
                  onClick={onScan}
                  aria-label="Scan a barcode"
                  title="Scan a barcode"
                >
                  <ScanBarcode className="size-5" />
                </button>
              )}
            </div>
            <p className="min-h-6 text-center text-sm font-semibold text-ink/50">
              {HINTS[phase] ??
                (pendingImage
                  ? "Tap the orb and describe what's in the photo."
                  : "Tap the orb and just talk — “I had two eggs and a coffee for breakfast.”")}
            </p>
          </>
        )}
      </main>

      {errorMessage && <ErrorBanner message={errorMessage} />}
    </div>
  );
}
