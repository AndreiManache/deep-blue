import { useEffect, useState } from "react";

// Decodes a stored base64 voice note into a real Blob + object URL instead
// of a raw `data:` URI string (2026-08-31 — feedback inbox playback bug
// investigation). A data URI's <mediatype> segment and the trailing
// `;base64,` marker are both semicolon-delimited, and MediaRecorder's own
// mimeType always includes a `;codecs=...` parameter (e.g.
// "audio/webm; codecs=opus") — concatenating that directly into
// `data:${mime};base64,...` produces a string with two semicolons in the
// type position, which is ambiguous to parse and not something every
// browser/webview handles the same way. A Blob's `type` property has no
// such ambiguity: it accepts the full mime string, parameters and all, with
// no string-parsing pitfalls, and is also far more memory-efficient for a
// multi-hundred-KB recording than holding the base64 text inline as a DOM
// attribute.
export function useAudioObjectUrl(base64: string | null | undefined, mime: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!base64) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime || "audio/mp4" });
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    } catch {
      setUrl(null); // malformed base64 — the <audio> element just shows nothing to play
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [base64, mime]);

  return url;
}
