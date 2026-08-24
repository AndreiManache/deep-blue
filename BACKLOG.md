# Deep Blue — Backlog

Improvements identified in review, not yet implemented. Ordered by priority within each group.

## Platform gaps

- [ ] **iPhone can't use voice conversation.** Every iOS browser (Chrome included — Apple mandates WebKit under the hood for all iOS browsers) lacks `SpeechRecognition` support. `speechSynthesis` (the AI speaking) *does* work on iOS — only the listening half is broken. Dashboard/profile work fine on iPhone today since they're plain UI, no speech APIs. Fix requires a real new integration: record audio via `MediaRecorder` (supported on iOS Safari 14.3+) and send it to a paid cloud STT provider (Whisper, Deepgram, etc.) as an iOS-specific fallback path in [recognition.ts](web/src/speech/recognition.ts) — new provider, new API key, small added per-minute cost. Deliberately deferred (2026-08-24) in favor of shipping cloud hosting first.

## Bugs

- [ ] **Tool-loop exhaustion corrupts session history.** If a `/chat` turn burns all `MAX_TOOL_ITERATIONS` (5) without the model reaching `end_turn`, [chat.ts](server/src/chat.ts) saves history ending in dangling tool results with no closing assistant message, and returns a fabricated "Okay." reply. The next turn on that session can then fail or behave oddly. Fix: on exhaustion, append a synthetic assistant close to history and return a real spoken fallback ("Sorry, that got complicated — can you try again?").
- [ ] **`raw_transcript` doesn't store what the user actually said.** Spec defines it as "what the user actually said," but `log_food`'s dispatch in [tools.ts](server/src/tools.ts) falls back to the model's cleaned `description` when the model doesn't pass `raw_transcript` explicitly (which it never does, since it's not a documented input to the tool). Fix: thread the real `user_text` from `runTurn` down into `executeTool`/`createEntry`.

## Robustness

- [ ] **No request timeout on the Anthropic client.** Default SDK timeout is 10 minutes — a hung request strands the UI in "thinking" indefinitely. Add `timeout`/`maxRetries` to the `Anthropic` client in [chat.ts](server/src/chat.ts), and an `AbortController`-based timeout on the frontend's `sendChat` fetch in [client.ts](web/src/api/client.ts).
- [ ] **No input validation on `PUT /profile` or entry writes.** A malformed `weight_kg` or out-of-enum `activity_level` goes straight into SQLite and then into the BMR formula in [profile.ts](server/src/profile.ts). Add basic server-side validation.
- [ ] **Sessions never expire.** The in-memory history `Map` in [sessions.ts](server/src/sessions.ts) only clears on `end_conversation` — closing the tab mid-conversation leaks that entry until the server restarts. Add a periodic idle sweep.
- [ ] **Backend process lifecycle isn't self-sufficient.** The root `npm run dev` script (concurrently) needs a root `npm install` to actually work — currently unverified. Fix and document so the app can be started without needing this conversation.

## UX polish

- [ ] **TTS voice selection.** Currently uses whatever default voice Chrome picks. Prefer a natural voice (e.g. Google US English) when available in [synthesis.ts](web/src/speech/synthesis.ts) — likely the single biggest perceived-quality improvement available for free.
- [ ] **Speech language hardcoded to `en-US`.** Worth making configurable (profile field?) if conversing in Romanian is ever wanted — Haiku itself handles Romanian food logging fine, this is purely the `SpeechRecognition.lang` setting in [recognition.ts](web/src/speech/recognition.ts).
- [ ] **Prefetch the profile name on app load** instead of on tap, to shave the small delay before the greeting starts speaking.

## Engineering hygiene

- [ ] **No git repository yet.** ~40 file changes with zero version control. `git init` + first commit (`.env` already gitignored).
- [ ] **No README.** Setup steps, env vars, run commands, Chrome requirement.
- [ ] **No tests** on the pure functions most likely to break silently later: `truncatePairSafe` ([sessions.ts](server/src/sessions.ts)) and `computeTargets` ([profile.ts](server/src/profile.ts)).

## Explicitly not worth doing (per spec's cost/scope philosophy)

- Prompt caching, streaming, temperature tuning — negligible savings at single-user scale.
- Auth, Postgres, real hosting infra — out of scope until "make it public" actually happens (see current work).

## Security note

- The Anthropic API key was pasted into chat during setup — treat it as exposed. Regenerate at console.anthropic.com and update `.env` when convenient.
