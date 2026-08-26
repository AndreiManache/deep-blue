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
| `DEEPBLUE_USERNAME` | Display name fallback (note: `DEEPBLUE_USERNAME`, not `USERNAME` — that collides with a built-in Windows env var) |
| `DEEPBLUE_DB_PATH` | Set to `/data/deepblue.db` — must point into the mounted volume or data won't survive a redeploy |

**Auth:** the app uses username + password accounts with open self sign-up — there is **no** auth env var. Accounts (`users`) and session tokens (`auth_sessions`) live in the SQLite database, so `DEEPBLUE_DB_PATH` pointing at the persistent volume is what keeps people logged in and their accounts alive across redeploys. Session tokens are opaque 32-byte values, valid 30 days; passwords are scrypt-hashed. There is no password reset — a forgotten password means deleting that `users` row and re-registering.

**Stale/legacy:** old `ACCESS_CODE` (singular) and `ACCESS_CODES` (plural) vars may still be set from the previous access-code auth — both are now unused (nothing reads them) and safe to leave or remove. A user who registers the username `andrei` inherits the data previously keyed to that identity.

To change any of these: `railway variables --set "KEY=value"`, then redeploy (variable changes alone don't trigger a redeploy).

## Deploying a change — automatic via Railway (no PC needed)

The Railway service is connected directly to this GitHub repo (service → **Settings → Source**): repo `AndreiManache/deep-blue`, branch **`master`**, **auto-deploy on push enabled**. So **any update to `master` — e.g. a merged PR — deploys automatically.** No token, no local CLI, no GitHub secret needed.

- **To ship a change:** get it onto `master` (merge its PR). Railway builds the repo root — the `package.json` `build`/`start` scripts — and redeploys.
- **To redeploy or roll back by hand:** Railway dashboard → the service → **Deployments** → redeploy a build.

"Wait for CI" is off, so Railway deploys immediately on push without waiting for any GitHub checks. (There is intentionally no GitHub Actions deploy workflow — Railway's own GitHub integration does the deploying.)

## Deploying manually from a PC (fallback)

**Only needed if the Railway↔GitHub connection above is ever removed.** A plain `git push` deploys via that connection; this `railway up` path is the manual alternative.

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
