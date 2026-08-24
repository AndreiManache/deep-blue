interface MicPermissionHelpProps {
  onRetry: () => void;
}

export function MicPermissionHelp({ onRetry }: MicPermissionHelpProps) {
  return (
    <div className="mic-permission-help">
      <h2>Microphone access is blocked</h2>
      <p>Deep Blue needs your microphone to have a conversation.</p>
      <p>
        If you dismissed the browser’s permission prompt, tap "Try again" and choose <strong>Allow</strong>.
      </p>
      <button className="pill-button" onClick={onRetry}>
        Try again
      </button>
      <p className="mic-permission-help-note">
        Already blocked it? Open the site settings — the lock or "aA" icon next to the address — set
        <strong> Microphone</strong> to <strong>Allow</strong>, then reload.
      </p>
    </div>
  );
}
