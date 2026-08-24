# Deploying Deep Blue to Railway

Deep Blue runs as a single service — Express serves both the API and the built React frontend from the same origin, so there's only one URL and one thing to deploy.

## Prerequisites

- A [Railway](https://railway.app) account (free to create; the Hobby plan, ~$5/mo, is needed for a persistent volume — see below).
- The [Railway CLI](https://docs.railway.app/guides/cli): `npm install -g @railway/cli`
- Your Anthropic API key.
- A password/passphrase of your choosing for `ACCESS_CODE` (see below — this is what protects the app once it's public).

## Why a volume is required

SQLite stores its data as a single file (`deepblue.db`). Railway's default container filesystem is wiped on every redeploy — without a persistent volume, your food log and profile would disappear the next time you push a change. The steps below attach a small volume and point the app at it via `DEEPBLUE_DB_PATH`.

## Steps

1. **Log in and initialize the project** (run from `D:\DeepBlue`):
   ```bash
   railway login
   railway init
   ```
   Choose "Create new project" when prompted.

2. **Attach a persistent volume**, mounted at `/data`:
   ```bash
   railway volume add --mount-path /data
   ```
   (Or via the Railway dashboard: your service → Settings → Volumes → New Volume → mount path `/data`.)

3. **Set environment variables** (via CLI or the dashboard's Variables tab):
   ```bash
   railway variables --set "ANTHROPIC_API_KEY=sk-ant-..." \
     --set "DEEPBLUE_USERNAME=Andrei" \
     --set "ACCESS_CODE=choose-a-passphrase" \
     --set "DEEPBLUE_DB_PATH=/data/deepblue.db"
   ```
   `ACCESS_CODE` is what the app will ask for the first time you open it on a new device — pick something easy to type on a phone once, since it's stored after that and not asked again on that device.

4. **Deploy:**
   ```bash
   railway up
   ```
   Railway detects the root `package.json`'s `build`/`start` scripts automatically (no Dockerfile needed) — `build` compiles both `server/` and `web/`, `start` runs the compiled server, which serves the compiled frontend.

5. **Get your public URL** — either shown at the end of `railway up`, or via `railway domain` to generate one if it isn't already assigned. It'll be an `https://*.up.railway.app` address; HTTPS is automatic, which is required for the Web Speech API to work on Android Chrome.

6. **Open it on your phone**, enter your `ACCESS_CODE` once when prompted, and try a full conversation.

## Redeploying after future changes

From `D:\DeepBlue`: `railway up`. The volume and env vars persist across deploys — only the code changes.

## Rotating the access code

If you ever want to revoke access (e.g. you shared the URL and want to cut it off): `railway variables --set "ACCESS_CODE=new-passphrase"`, then redeploy. Every device will need the new code on its next request.
