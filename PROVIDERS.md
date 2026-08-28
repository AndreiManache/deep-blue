# AI providers — switching between Anthropic/ElevenLabs and Gemini

Deep Blue can run its LLM (the voice conversation + tool-calling brain) and
its TTS (reply audio) on either of two provider stacks, switched
independently via environment variables. Nothing else in the app needs to
change — the switch happens at the two "front door" modules every route
goes through: `server/src/llmProvider.ts` and `server/src/ttsProvider.ts`.

## The switches

In `.env` (local) or your Railway service variables (production):

```bash
LLM_PROVIDER=anthropic   # or: gemini
TTS_PROVIDER=elevenlabs  # or: gemini
```

Both default to the original stack (`anthropic` / `elevenlabs`) if unset, so
leaving them out of `.env` entirely reproduces exactly what's running today.

**They're independent.** You can run Claude with Gemini's voice, or Gemini
with ElevenLabs' voice, or any other combination — useful for isolating
*which* half of a comparison you're actually testing. There's no in-app
toggle by design (see the "why not a live toggle" note below) — flip the
variable and restart the server.

## What you need

- **Anthropic path** (already set up): `ANTHROPIC_API_KEY` for the LLM,
  `ELEVENLABS_API_KEY` for TTS/STT (STT is unaffected by either switch —
  ElevenLabs Scribe still transcribes what the user says either way).
- **Gemini path**: `GEMINI_API_KEY` — get one at
  [aistudio.google.com/apikey](https://aistudio.google.com/apikey). One key
  covers both `LLM_PROVIDER=gemini` and `TTS_PROVIDER=gemini`.

Optional overrides (sane defaults already set in `config.ts`):

```bash
GEMINI_MODEL=gemini-3.7-flash        # the LLM
GEMINI_THINKING_LEVEL=low            # low | medium | high (low: latency)
GEMINI_TTS_MODEL=gemini-3.1-flash-tts-preview
GEMINI_VOICE_NAME=Kore               # one of ~30 prebuilt voice names
GEMINI_VOICE_NAME_RO=                # optional distinct Romanian voice
```

## How to actually compare them

1. Set the variable(s) in `.env`.
2. Restart the server (`tsx watch` doesn't pick up `.env` changes on its
   own — stop and re-run `npm run dev`, or in Claude Code's preview tools,
   stop and restart the "server" preview).
3. Talk to it. Everything — logging, editing entries, the barcode flow,
   diagnostics — behaves identically; only the model doing the talking (and
   the voice doing the speaking) changes.
4. Flip back the same way to compare.

On Railway: `railway variables --set "LLM_PROVIDER=gemini"` (etc.), then a
redeploy — variable changes alone don't trigger one, same as every other
env var in this app (see `DEPLOY.md`).

## What's actually different under the hood

- **Conversation history is stored differently per provider**, but neither
  is visible to the rest of the app. Anthropic's path stores an
  `Anthropic.MessageParam[]` array (`sessions.ts`); Gemini's path stores a
  `Step[]` array from the Interactions API (`geminiSessions.ts`). Both are
  resent in full on every turn (`store: false` on the Gemini side) rather
  than relying on either provider's server-side conversation state — kept
  deliberately parallel to how this app already worked, and means switching
  providers mid-conversation isn't supported (ending and restarting the
  conversation is the actual behavior if you flip the switch while one is
  live — a corner case, not something worth building for).
- **Tool/function definitions are defined once**, in `tools.ts`'s
  `toolDefs`, and mechanically adapted into each provider's own shape
  (`anthropicTools`, `geminiTools`). This is deliberate: hand-maintaining
  two separate copies of six tool schemas would drift out of sync over
  time. `executeTool()` itself — the part that actually touches the
  database — doesn't know or care which provider called it.
- **TTS audio format differs by provider**, so it's never assumed on the
  client anymore. ElevenLabs returns MP3; Gemini's TTS model only emits raw
  16-bit PCM (confirmed against the live API — it rejects requests for MP3
  *or* WAV output directly), so `ttsGemini.ts` wraps that PCM in a minimal
  WAV header before returning it. Both `/chat` and `/greeting` now return an
  explicit `audio_mime` field, and the frontend's `<audio>` element uses
  whatever it's told instead of hardcoding `audio/mpeg`.
- **Self-healing session repair exists on both sides.** The Anthropic path
  already had `repairDanglingToolUse` (a defense against a real corruption
  bug hit in production — see git history). The Gemini path has the
  equivalent, `repairDanglingFunctionCall` in `geminiSessions.ts`.

## Why not a live in-app toggle

Considered and deliberately not built (yet). A per-request or per-user
switch would need to thread through auth/profile or a debug menu, be
guarded from accidental exposure to regular users, and — more importantly —
would make it harder to tell *which* provider actually produced a given
result when something goes wrong. An env var + restart is slower to flip
but keeps "which stack is live right now" an unambiguous, single fact about
the whole deployment. Revisit if comparing them stops being an occasional
thing and becomes routine.

## TTS: Murf Falcon 2 is the default (2026-08-28), the switch above is the Romanian path

Same pattern as STT below, for the same reason: there's no drop-in
Romanian-native alternative in the comparison, so it's not a global switch.

- **Set `MURF_API_KEY`** (get one at [murf.ai](https://murf.ai) — console →
  API keys) and Murf's Falcon 2 model becomes the **default** TTS for every
  reply *except* one for a profile with `language: "ro"` explicitly set —
  that one uses whatever the `TTS_PROVIDER` switch above resolves to
  (Gemini, as currently set), regardless of this key.
- **Leave it unset** and TTS behaves exactly as the switch above says —
  no change.

**Deliberate choice, not a technical limitation**: Murf's cross-lingual
voices (an English-native voice reading non-English text) do produce valid
Romanian audio — live-verified against the real API (`en-UK-hazel` reading
a Romanian sentence returned a proper WAV, 200 OK). But an accented,
non-native voice is an unverified quality bet, so Romanian keeps using
Gemini's dedicated Romanian voice support instead until someone judges that
tradeoff worth making. `MURF_VOICE_ID` (default `en-US-natalie`, confirmed
against Murf's own `GET /v1/speech/voices` catalog of 162 voices) picks the
English voice.

**Live-verified**: real API calls for both the English path (`en-US-natalie`,
Falcon 2) and the Romanian cross-lingual path returned proper WAV audio
(confirmed via `file` — valid RIFF/WAVE, 16-bit PCM, 24kHz). The response is
raw audio bytes directly in the HTTP body (`Content-Type: audio/wav`,
chunked) — no JSON wrapper, no PCM-to-WAV hack needed unlike Gemini's TTS.
Also verified the dispatch itself end-to-end: a `null`/`"en"` profile logs
`[ttsProvider] synthesized via Murf Falcon 2`; a `"ro"` profile produces no
such line and falls straight through to Gemini TTS instead. Any Murf
failure falls back to the `TTS_PROVIDER` switch transparently, same pattern
as the STT fallback.

## STT: Smallest AI is the default (2026-08-28), ElevenLabs is the Romanian path

Speech-to-text is handled differently from the LLM/TTS switches above — it's
not a global toggle, because there isn't a drop-in Romanian-capable
alternative in the mix. Instead:

- **Set `SMALLESTAI_API_KEY`** (get one at [smallest.ai](https://smallest.ai)
  — console → API keys, $10 free credit to start) and Smallest AI's Pulse
  Pro model becomes the **default** STT for every request *except* one from
  a profile with `language: "ro"` explicitly set — that one always goes to
  ElevenLabs Scribe (`scribe_v2`), regardless of this key.
- **Leave it unset** and STT behaves exactly as it always has — Scribe for
  everyone.

**Deliberate tradeoff, accepted 2026-08-28**: Pulse Pro is English-only
(confirmed against its model card at
[docs.smallest.ai](https://docs.smallest.ai/models/model-cards/speech-to-text/pulse-pro)).
The *previous* design specifically routed the language-unknown case (a
brand-new user, before they've ever stated a preference) to Scribe, because
Scribe's auto-detect is what let a first-time Romanian speaker be noticed and
switched automatically (`systemPrompt.ts`'s language-detection rule depends
on that first utterance transcribing correctly *before* anyone has told the
app which language they're using). Making Smallest AI the default gives that
up: a brand-new user's first Romanian sentence, before they've set Language
to Romanian in Profile, is likely to transcribe poorly. The intended
interaction now is that a Romanian speaker sets their language in Profile
up front, rather than relying on the app to notice from speech alone. Any
Smallest AI failure — including a possible container/format rejection, see
below — still falls back to Scribe transparently on the same audio bytes.

**Live-verified**: a real spoken WAV clip (synthesized via Gemini TTS, so
genuine speech rather than silence) round-tripped through Pulse Pro came
back with an exact transcript match, confirming the API contract — auth,
request shape, response parsing — is correct. The dispatch gate itself was
verified against the *previous* (opt-in) version of this logic — `"en"`
routed to Smallest AI, `"ro"`/unset stayed on ElevenLabs — before the
default flipped; the gate condition changed (`!== "ro"` instead of
`=== "en"`) but the underlying call to each provider is identical code, so
this isn't considered a re-verification risk.

**Still open**: that test used WAV, one of Smallest AI's explicitly
documented formats. The real recordings this app captures are containers —
`audio/webm;codecs=opus` on Chrome/Android, `audio/mp4` on iOS Safari — which
their docs don't explicitly confirm. `sttSmallest.ts` uploads those bytes
as-is with no transcoding. Until a real recorded clip from each platform is
tested, treat that specific compatibility as unverified — the
fallback-to-Scribe design means a bad guess there costs extra latency, not
a broken turn, but it's not proof the speedup is actually landing on a real
phone yet. Watch the server logs for the `[sttProvider]` line after a real
voice turn from an `language: "en"` account — its presence (or the
`[sttProvider] Smallest AI failed, falling back to ElevenLabs` line instead)
tells you which happened.

## Known constraints worth knowing before you judge a comparison

- **Free-tier Gemini quota is very restrictive.** At verification time, the
  `gemini-3.7-flash` model hard-capped a free-tier Google AI Studio project
  at **5 requests total** before every call returned `429 Quota exceeded`.
  That's nowhere near enough for a real usage comparison — you'll need
  billing enabled on the Google Cloud project behind your API key
  (aistudio.google.com/apikey → the project → "Set up billing") before
  `LLM_PROVIDER=gemini` is usable beyond a handful of test turns.
  `gemini-3.6-flash` was used as a stand-in during development specifically
  to work around this and verify the integration itself is correct — the
  code defaults to `gemini-3.7-flash` as requested, but expect to hit this
  quota fast until billing is on.
- **Gemini TTS's voice-quality/latency characteristics haven't been
  judged yet** — the WAV-wrapping fix was verified for correctness (a real
  `<audio>` element in a real browser played it start to finish,
  `loadedmetadata` → `ended`), not for how it *sounds* next to ElevenLabs.
  That's exactly the comparison this whole feature exists to let you make.
- **Tool-calling reliability is the real open question**, more than raw
  text quality. Verified working end-to-end (a two-turn conversation:
  `log_food` then `get_entries`, both called correctly), but "worked once"
  isn't the same as "as reliable as Claude's tool use across the range of
  ways people actually describe food" — that only shows up with real usage
  over time.
