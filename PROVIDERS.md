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
GEMINI_THINKING_LEVEL=high           # low | medium | high
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

## STT: an English-only speedup, not a third switch

Speech-to-text is handled differently from the LLM/TTS switches above — it's
not a global toggle, because there isn't a drop-in Romanian-capable
alternative to compare against yet. Instead, one optional key
(`SMALLESTAI_API_KEY`) opts English-confirmed users into a faster STT model,
while everyone else keeps using ElevenLabs Scribe exactly as before:

- **Set `SMALLESTAI_API_KEY`** to route STT to Smallest AI's Pulse Pro model
  (get one at [smallest.ai](https://smallest.ai) — console → API keys, $10
  free credit to start) — but *only* for a request whose profile already has
  `language: "en"` confirmed. Romanian profiles, and the language-unknown
  case for brand-new users, always go to Scribe.
- **Leave it unset** and STT behaves exactly as it always has — Scribe,
  auto-detecting, for everyone.

Why gated on confirmed English rather than a blanket switch: Pulse Pro is
English-only (confirmed against its model card at
[docs.smallest.ai](https://docs.smallest.ai/models/model-cards/speech-to-text/pulse-pro)).
Scribe's language-agnostic auto-detect is what lets a brand-new user address
Deep Blue in Romanian and have the app notice and switch
(`systemPrompt.ts`'s language-detection rule depends on that first utterance
being transcribed correctly *before* anyone has told the app which language
they're using) — routing language-unknown turns to an English-only model
would break that detection outright. Once a user's profile says
`language: "en"`, though, every future turn from them is safe to route to
the faster model. Any Smallest AI failure — including a possible container/
format rejection, see below — falls back to Scribe transparently on the
same audio bytes, so this can't make a turn fail that would have worked
before.

**Live-verified**: a real spoken WAV clip (synthesized via Gemini TTS, so
genuine speech rather than silence) round-tripped through Pulse Pro came
back with an exact transcript match, confirming the API contract — auth,
request shape, response parsing — is correct. Also confirmed the dispatch
gate itself: `language: "en"` routes to Smallest AI (logged as `[sttProvider]
transcribed via Smallest AI Pulse Pro`), while `"ro"` and unset both route
straight to ElevenLabs, untouched.

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
