# Deep Blue

Voice-first food logging. Talk to it, it logs the food.

For deployment, see [DEPLOY.md](DEPLOY.md). For the LLM/TTS/STT provider
switches (Anthropic/Gemini, ElevenLabs/Gemini/Murf, Scribe/Smallest AI), see
[PROVIDERS.md](PROVIDERS.md). Open items and ideas live in
[BACKLOG.md](BACKLOG.md).

## Stack

- **Server**: Express + TypeScript, `server/`. SQLite via Node's built-in
  `node:sqlite` (no native driver to install). Voice pipeline: STT → LLM
  (tool-calling) → TTS, see PROVIDERS.md for exactly which services.
- **Web**: React + Vite + Tailwind, `web/`. No native app — a voice-first
  single-page app that talks to the server over `fetch`.

## Prerequisites

- Node.js 20+ (this project runs on Node 24; anything reasonably recent
  works — `node:sqlite` needs a fairly modern version).
- An [Anthropic API key](https://console.anthropic.com) and/or a
  [Gemini API key](https://aistudio.google.com/apikey) — whichever
  `LLM_PROVIDER` you run.
- An [ElevenLabs API key](https://elevenlabs.io) on a **paid** plan — the
  free tier blocks API access entirely, and this app always needs
  ElevenLabs for something (Romanian STT, and the fallback path for
  everything else) regardless of which other providers are configured. See
  PROVIDERS.md before assuming any one provider is fully optional.
- A phone or a real browser to test voice in — a headless environment can't
  grant microphone access, so the voice pipeline can only be exercised in
  an actual browser tab.

## Setup

```bash
git clone https://github.com/AndreiManache/deep-blue.git
cd deep-blue
npm run install:all        # installs root, server/, and web/ separately
cp .env.example .env       # then fill in ANTHROPIC_API_KEY and ELEVENLABS_API_KEY at minimum
npm run dev                # runs server (:3001) and web (:5173) together
```

Open `http://localhost:5173`. Register any username/password — accounts are
open self-signup, stored in the local SQLite file next to `server/src/`
(override with `DEEPBLUE_DB_PATH`).

`.env.example` documents every variable, including the LLM/TTS/STT provider
switches (all optional, default to Anthropic + ElevenLabs) — read the
comment above each one before setting it blind.

## Running things separately

```bash
npm run dev:server   # server only, tsx watch, :3001
npm run dev:web       # web only, Vite, :5173
```

The web dev server proxies API calls to `:3001` — running only one half
won't get you a working app, but is useful for isolating a build error.

## Tests

```bash
npm test              # server test suite (Node's built-in test runner via tsx)
```

Server-side only — see BACKLOG.md, there's no test infrastructure in
`web/` yet. Covers the tool-calling loop (both Anthropic and Gemini paths),
session repair/truncation logic, and the Anthropic/Gemini tool-schema
derivation (a drift guard, not a correctness test of either provider).

## Admin access

Set `ADMIN_USERNAMES` (server, comma-separated, lowercase) to unlock
`/admin/*` (feedback inbox, "Models in use" diagnostics) for those accounts.
Also set the matching `VITE_ADMIN_USERNAME` in `web/.env` — that one only
controls whether the menu item *shows up*; the real gate is the server-side
var, so a non-admin can't reach the routes even by guessing the URL.

## Browser requirements

The voice pipeline needs `getUserMedia` + `MediaRecorder` + `AudioContext`
(for volume-based turn-end detection) — recent Chrome (Android/desktop) and
Safari (iOS) both work. There's no fallback voice path for a browser
missing any of these; the app shows an "unsupported" screen instead.
