export function MicPermissionHelp() {
  return (
    <div className="mic-permission-help">
      <h2>Microphone access is blocked</h2>
      <p>Deep Blue needs your microphone to have a conversation.</p>
      <ol>
        <li>Click the lock/site-info icon in the address bar</li>
        <li>Find "Microphone" and set it to "Allow"</li>
        <li>Reload this page</li>
      </ol>
    </div>
  );
}
