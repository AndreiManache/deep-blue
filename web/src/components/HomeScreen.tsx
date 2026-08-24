import type { ConversationApi } from "../conversation/useConversation";
import { ErrorBanner } from "./ErrorBanner";
import { HamburgerMenu } from "./HamburgerMenu";
import { MicPermissionHelp } from "./MicPermissionHelp";
import { TalkButton } from "./TalkButton";

interface HomeScreenProps {
  conversation: ConversationApi;
  onNavigate: (view: "dashboard" | "profile") => void;
}

export function HomeScreen({ conversation, onNavigate }: HomeScreenProps) {
  const { phase, interimTranscript, errorMessage, micPermissionDenied, startSession, endTurn, endSession } =
    conversation;

  if (phase === "unsupported") {
    return (
      <div className="unsupported-screen">
        <div className="mic-permission-help">
          <h2>Browser not supported</h2>
          <p>Deep Blue needs Chrome (or another Chromium-based browser) for speech recognition and voice output.</p>
        </div>
      </div>
    );
  }

  function handleTap() {
    if (phase === "idle") {
      startSession();
    } else if (phase === "listening") {
      endTurn();
    }
    // thinking / speaking: no barge-in in the MVP — tap is a no-op.
  }

  const sessionActive = phase !== "idle";

  return (
    <div className="home-screen">
      <HamburgerMenu onNavigate={onNavigate} />

      {micPermissionDenied ? (
        <MicPermissionHelp onRetry={startSession} />
      ) : (
        <div className="talk-button-wrap">
          <TalkButton phase={phase} onTap={handleTap} />
          <div className="interim-caption">{phase === "listening" ? interimTranscript : ""}</div>

          {sessionActive && (
            <div className="end-turn-controls">
              <button className="pill-button danger" onClick={endSession}>
                End conversation
              </button>
            </div>
          )}
        </div>
      )}

      {errorMessage && <ErrorBanner message={errorMessage} />}
    </div>
  );
}
