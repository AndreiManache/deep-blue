# Deploying Deep Blue to Railway

Deep Blue runs as a single service — Express serves both the API and the built React frontend from the same origin, so there's only one URL and one thing to deploy.

**Live URL:** https://deep-blue-production.up.railway.app

## Prerequisites (one-time machine setup)

- A [Railway](https://railway.app) account (Hobby plan, ~$5/mo, needed for a persistent volume — see below).
- The [Railway CLI](https://docs.railway.app/guides/cli): `npm install -g @railway/cli`, then `railway login`.
- Node.js + npm (this machine: Node v24, npm v11 — anything reasonably recent works).
- Git configured with push access to `https://github.com/AndreiManache/deep-blue.git` (this machine uses HTTPS + a credential helper, not SSH — `git push` should just work without a prompt).
- Your Anthropic API key and (if using premium voice) an ElevenLabs API key.

Verify the machine is ready at any time with:
```bash
railway whoami        # confirms you're logged in
railway status         # confirms this folder is linked to the deep-blue project + shows live status
```
`railway status` only works when run from `D:\DeepBlue` — the CLI's project link is tied to this exact folder path (stored globally under your user profile, not in the repo), so a fresh clone in a different location needs `railway link` run once to reconnect it to the existing project.

## Why a volume is required

SQLite stores its data as a single file (`deepblue.db`). Railway's default container filesystem is wiped on every redeploy — without a persistent volume, your food log and profile would disappear the next time you push a change. A volume is already attached in production, mounted at `/data`, pointed at via the `DEEPBLUE_DB_PATH` env var. (For a brand-new project: `railway volume add --mount-path /data`, or via the dashboard's Settings → Volumes.)

## Environment variables (already set in production)

Check current names (not values) with `railway variables --kv`. As of the last deploy, these are set on the `deep-blue` service:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `ELEVENLABS_API_KEY` | Premium TTS voice; if unset/failing, app falls back to browser `speechSynthesis` automatically |
| `ACCESS_CODES` | Multi-user auth, format `code1:userid1,code2:userid2` (e.g. `andrei23:andrei,Maria:maria`) — each code maps to an isolated identity/data set |
| `DEEPBLUE_USERNAME` | Display name (note: `DEEPBLUE_USERNAME`, not `USERNAME` — that collides with a built-in Windows env var) |
| `DEEPBLUE_DB_PATH` | Set to `/data/deepblue.db` — must point into the mounted volume or data won't survive a redeploy |

**Stale/legacy:** an old `ACCESS_CODE` (singular) var is also still set from before multi-user support shipped — it's unused now that `ACCESS_CODES` (plural) exists. Harmless to leave, but don't be confused by it showing up in `railway variables --kv`.

To change any of these: `railway variables --set "KEY=value"`, then redeploy (variable changes alone don't trigger a redeploy).

To rotate/revoke a user's access code: update their entry in `ACCESS_CODES` and redeploy — that device will need the new code on its next request.

## Deploying a change — the actual procedure

**Important: pushing to GitHub does NOT deploy anything.** This project has no Railway↔GitHub auto-deploy hook connected — `git push` only updates the repo. Deploying is a separate, manual step.

1. **Land your change on `master`.** This repo uses feature branches + PRs (not direct commits to `master`). From `D:\DeepBlue`:
   ```bash
   git checkout master
   git pull origin master
   ```
   (If your change is on a feature branch and already merged via PR on GitHub, `git pull` picks that up. If not yet merged, merge/PR it first.)

2. **Deploy the current `master` working tree:**
   ```bash
   railway up
   ```
   This uploads and builds `D:\DeepBlue` as it currently sits on disk — not what's on GitHub. Make sure your working tree actually matches `master` (`git status` clean, no stray local edits) before running it. Railway detects the root `package.json`'s `build`/`start` scripts automatically (no Dockerfile) — `build` compiles both `server/` and `web/`, `start` runs the compiled server, which also serves the compiled frontend.

3. **Confirm it went live:**
   ```bash
   railway status   # watch for status to settle on "Online" (it may briefly flash "Crashed" mid-deploy — that's normal, not a failure)
   railway logs      # tail recent logs; look for "Deep Blue server listening on http://localhost:8080"
   curl -s -o /dev/null -w "%{http_code}\n" https://deep-blue-production.up.railway.app   # expect 200
   ```

4. **Sanity-check on a real device** if the change touches voice/UI — open the live URL on your phone and run a full conversation.

## Direct production DB access (maintenance only)

SSH access to the production container is already set up on this machine (key at `~/.ssh/id_ed25519`, registered with Railway, host key trusted — this is a Railway SSH key, unrelated to the GitHub HTTPS credentials above). Use `railway ssh` for one-off inspection of the production SQLite file. Local dev (`localhost:3001`) and production use separate databases — testing locally never touches real data, and vice versa.
