import { ScanBarcode, Shield } from "lucide-react";
import type { ConversationApi, Phase } from "../conversation/useConversation";
import { useT, type StringKey } from "../i18n/useT";
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

const HINT_KEYS: Partial<Record<Phase, StringKey>> = {
  "awaiting-mic": "home.hintAwaitingMic",
  listening: "home.hintListening",
  thinking: "home.hintThinking",
  speaking: "home.hintSpeaking",
};

export function HomeScreen({ conversation, onNavigate, onScan, onLogout, isAdmin }: HomeScreenProps) {
  const t = useT();
  const {
    phase,
    errorMessage,
    micPermissionDenied,
    holdStart,
    holdEnd,
    requestMicPermission,
    pendingImage,
    attachImage,
    clearImage,
  } = conversation;

  return (
    <div className="flex min-h-dvh flex-col px-6 pb-10 pt-5">
      <header className="flex items-center justify-between">
        <HamburgerMenu onNavigate={onNavigate} onLogout={onLogout} />
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
              {t("home.unsupportedTitle")}
            </h1>
            <p className="mt-2 text-sm font-medium text-ink/60">{t("home.unsupportedBody")}</p>
          </div>
        ) : micPermissionDenied ? (
          <div className="w-full max-w-sm">
            <MicPermissionHelp onRetry={requestMicPermission} />
          </div>
        ) : (
          <>
            <Greeting />
            <TalkButton phase={phase} onHoldStart={holdStart} onHoldEnd={holdEnd} />
            <div className="flex items-center justify-center gap-4">
              <PhotoAttach image={pendingImage} onAttach={attachImage} onClear={clearImage} />
              {!pendingImage && (
                <button
                  className="grid size-14 place-items-center rounded-full bg-white text-ink/70 shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
                  onClick={onScan}
                  aria-label={t("home.scanBarcode")}
                  title={t("home.scanBarcode")}
                >
                  <ScanBarcode className="size-5" />
                </button>
              )}
            </div>
            {HINT_KEYS[phase] ? (
              <p className="min-h-6 text-center text-sm font-semibold text-ink/50">{t(HINT_KEYS[phase]!)}</p>
            ) : pendingImage ? (
              <p className="min-h-6 text-center text-sm font-semibold text-ink/50">
                {t("home.hintPhotoAttached")}
              </p>
            ) : isAdmin ? (
              <button
                className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-bold text-ink shadow-sm ring-1 ring-ink/5 transition-colors hover:bg-ink3"
                onClick={() => onNavigate("admin-panel")}
              >
                <Shield className="size-4 text-coral" />
                {t("home.adminPanel")}
              </button>
            ) : (
              <p className="min-h-6 text-center text-sm font-semibold text-ink/50">
                {t("home.hintDefault")}
              </p>
            )}
          </>
        )}
      </main>

      {errorMessage && <ErrorBanner message={errorMessage} />}
    </div>
  );
}
