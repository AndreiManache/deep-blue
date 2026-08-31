# Deep Blue — Backlog

Ideas and open items to consider going forward. Shipped/completed work has been pruned — see git history for what's already done.

## Feedback-as-tickets & achievements (2026-08-29, user's idea)

- [ ] **Auto-generate a title + short description for each ticket from its voice note, 2026-08-30.** Requested specifically to make triage faster — both for Andrei scanning the admin inbox and for Claude picking up a report to work on, neither of which should have to read/listen to the full raw content just to know what a ticket is about. Design direction: reuse the transcript that already exists (`transcript` column, produced on-demand via the admin inbox's "Transcribe" button, [feedback.ts](server/src/feedback.ts)) rather than sending raw audio to an LLM — one cheap text-only call (the same low-cost model already used elsewhere, e.g. Gemini 3.5 Flash-Lite) with a short prompt asking for a title (a few words) and a one-sentence summary. Store as new `title`/`summary` columns, generated and cached once (same pattern as `transcript` and `resolution_note`) rather than regenerated every time the inbox loads. Follows the existing on-demand-not-automatic precedent from transcription itself (`feedback.ts`'s own comment: "not automatically on submit, to avoid paying for STT on reports nobody ends up needing") — likely a button next to "Transcribe voice note" in `AdminFeedbackPage.tsx`, possibly auto-triggered right after a transcript is produced rather than a fully separate click. Surface the title in both the admin inbox list and the reporter's own "My Feedback" screen (built 2026-08-30, PR merged) so a reporter with several reports can also tell them apart at a glance instead of reading each message/transcript in full.
- [ ] **v2: proactively notify the reporter when their feedback is resolved** — not just the passive "check the My Feedback screen" v1 shipped 2026-08-30 (see git history / PR: `resolution_note` column, admin can write a note per report, reporter's own read-only "My Feedback" screen shows status + note). A banner, or the greeting mentioning "that thing you reported got fixed," once real usage shows people actually want to be told rather than check manually. Also revisit Web Push at this point if it's still relevant — see the earlier "notification" conversation: works directly in-browser on Android/desktop, but on iOS only for a PWA added to the home screen, and (as of 2026) not even then for EU users specifically, due to Apple disabling standalone PWA mode there under the DMA — a real constraint given the actual user base is Romania-based.
- [ ] **Achievement/gamification system for users who help improve the app — explicitly a later idea, not v1.** Reward a user (badge, in-app recognition, something) when a piece of feedback they submitted gets marked resolved — turns "reported a bug" into a small win instead of a one-way complaint. Explicitly sequenced *after* the notification item above, not just ticket-visibility — an achievement for "your ticket got closed" lands better as a proactive moment than something the user has to go discover on a screen. No design work done on this yet (what counts as achievement-worthy, what the reward actually is, whether it's cosmetic or functional) — flagged here purely so the idea isn't lost, not as a spec.

## Monetization (2026-08-28)

- [ ] **Subscription billing infrastructure — doesn't exist yet.** No Stripe (or other processor) integration, no paywall, no plan/entitlement gating anywhere in the codebase. This is the actual prerequisite for anything in [MONETIZATION.md](MONETIZATION.md) — that document is the pricing *strategy*, this is the missing engineering to act on it. Needs: a checkout flow (Stripe Checkout is the simplest starting point), a webhook handler to update subscription status, a gate somewhere in the `/chat` or `/transcribe` path (or a soft paywall in the UI) once there's a free-tier limit to enforce, and a decision on monthly vs. annual-only vs. both at launch (MONETIZATION.md §2 shows annual meaningfully reduces payment-processing drag). Consider a merchant-of-record (Paddle, Lemon Squeezy) instead of raw Stripe specifically to avoid handling EU VAT compliance solo — real margin tradeoff, see MONETIZATION.md §7.

## User-reported feedback (2026-08-29 triage)

Transcribed and triaged from the feedback inbox (10 voice notes + 1 text
note, Aug 27-28, from Andrei/Maria/Daniel — Daniel is a friend Andrei showed
the app to at a bar). Eight reports are resolved and not listed below: two
matched bugs already fixed earlier this session (a conversation freezing
mid-turn while the user paused to think, and getting cut off mid-sentence
describing a full day of eating — both addressed by the turn-hang and
`MAX_TURN_MS` fixes, PRs #20/#22/#23), three were addressed directly in the
2026-08-29 backlog-burn-down pass (the "send another feedback" button,
surfacing the Mifflin-St Jeor BMR formula in Profile, and renaming the
Dashboard menu label to "Jurnal alimentar" for Romanian profiles), the
spoken-calorie-mismatch bug was root-caused and fixed the same day,
recording-with-a-photo-attached was confirmed resolved by the user
2026-08-30 (superseded by earlier fixes, not separately root-caused), and
slow barcode scanning was root-caused and fixed 2026-08-30 too — no
resolution constraint on the camera stream, and no format restriction on
the decoder (live-verified: restricting to the four retail formats this
app can ever use cuts the decoder's internal reader count from 7 to 1 per
frame, on top of a smaller per-frame resolution).
Everything below is still open.

- [ ] **Back button missing/inconsistent, specifically on Profile — investigated 2026-08-29, could not reproduce.** Maria: wants a reliable way to go back, called out the Profile page by name. Tested `BackHeader`'s back button on Profile at both desktop and mobile (375x812) viewport sizes: present, visible, correctly positioned, not obscured by any overlapping element, and navigates back to Home correctly on click every time. Left open rather than closed — a real-device issue (mobile Safari's collapsing toolbar shifting `100dvh` calculations, or a specific navigation path not tested) can't be ruled out from here. Whoever revisits this should ask Maria to reproduce it live before assuming it's fixed by anything above.
- [ ] **Noise robustness in loud environments — partially addressed, unverified.** Daniel, via Andrei: tried the app at a noisy bar and it didn't work well (presumably STT failing to pick up speech over noise). The 2026-08-28 switch to Smallest AI Pulse Pro as the default STT ([PROVIDERS.md](PROVIDERS.md)) claims automatic background-noise handling per their docs, but that claim is unverified against real loud-environment audio — don't consider this resolved until someone actually retests in a noisy setting.

## Personal food database (2026-08-27)

- [ ] **Bigger, riskier idea, flagged honestly: skip the LLM call entirely for confident repeat foods, to actually reduce cost.** Important distinction from the above: the existing system already avoids trusting a *fresh guess* for known foods, but it does **not** currently save any LLM cost, because the model still runs its full reasoning on every turn regardless of whether the server ends up using its number — the expensive part is understanding the sentence ("I had two eggs and a coffee"), not guessing the calories. Actually bypassing the model for a turn is a real architecture change with real risk (misparsing a turn that only *sounds* like an exact repeat, e.g. missing "...and also skipped lunch" tacked onto what looks like a simple repeat). Worth exploring later — e.g. a narrow, high-confidence fast path for near-verbatim repeats of a personal favorite — but should be scoped and built as its own careful feature, not assumed to fall out of the database work above.

## Feedback & admin (from the friends-beta rollout, 2026-08-27)

- [ ] **Full "see all users and their behavior" admin panel.** Bigger scope than the feedback inbox (new tables/queries for engagement, not just a list to triage), and there isn't enough real usage yet to make a dashboard worth building. Interim: Railway SSH access to the production SQLite file already lets Andrei run one-off queries directly (`... | railway ssh -- node`) — e.g. `SELECT COUNT(*) FROM users`, `SELECT user_id, COUNT(*), MAX(created_at) FROM food_entries GROUP BY user_id` for who's logging and how recently, `SELECT username, created_at FROM auth_sessions ORDER BY created_at DESC` for recent logins. Manual and ad-hoc, but sufficient for occasional spot-checks during a small beta.
- [ ] **Per-user API cost/usage logging.** Log LLM token counts and TTS/STT usage per `user_id`/session in the DB — now a four-vendor stack (Gemini, Murf, Smallest AI, ElevenLabs, per PROVIDERS.md) rather than just Claude+ElevenLabs, which makes an at-a-glance spend picture harder to reconstruct after the fact and a per-account log more valuable, not less. So a runaway user or a bug causing loops is visible per-account, not just as a total spend surprise across four dashboards. Ties into the admin panel above once that gets built. Until then, each provider's own console/dashboard usage alerts are the cheap interim guardrail.
- [ ] **Image upload for feedback reports — explicitly requested by Andrei, 2026-08-30 (the "add once friends actually ask for it" condition is now met).** Specifically: attach an *already-taken* photo (camera roll / file picker), not a live in-app camera capture — a different, simpler flow than `BarcodeScanner.tsx`'s live camera view. `PhotoAttach.tsx` (used for photo-based food logging) already has almost exactly this: a file input + client-side resize-to-JPEG-under-1024px via canvas, producing a small base64 payload with no server storage changes needed — the food-logging path sends that straight to the LLM per-turn without persisting the image at all. Feedback needs the opposite (the image *does* need to persist, alongside the existing `audio_base64`/`message` on a `feedback` row — same inline-storage pattern, just a new `image_base64`/`image_mime` column pair), but the capture/resize half of the work is directly reusable, not a from-scratch build.

## Performance & cost

- [ ] **Reduce voice-turn latency further — streaming and/or skip the second LLM call.** Deliberately deferred 2026-08-28 rather than bundled into the gemini-3.5-flash-lite switch, per explicit request to ship the safe win now and not rush a bigger architecture change: "deliver something good, not make mistakes." Two independent levers, either or both:
  - **Stream the reply into TTS** — speak the first sentence while the rest generates and/or streams from the TTS provider, instead of awaiting the full text then the full audio file. Biggest perceived-speed lever; real engineering lift (Murf's `/v1/speech/stream` endpoint already streams audio bytes — see `ttsMurf.ts` — the missing half is streaming the *LLM* output into it incrementally).
  - **Skip the second Gemini call for a logged turn.** Every log_food turn currently makes two sequential model calls: one to decide the tool call, one more to phrase the confirmation reply. Since the logged result is already known server-side after the tool runs, that confirmation could be templated (or a short deterministic sentence) instead of model-generated, roughly halving LLM latency again. Real tradeoff: loses the model's natural phrasing/personality in the reply, and needs a Romanian template too — a deliberate quality decision, not a free win.
  - Current baseline after the flash-lite switch (2026-08-28, measured, includes Murf TTS): ~3s/turn. Worth re-measuring on a real phone before deciding whether either lever is still worth the complexity.
- [ ] **In-app cost tracker.** Log per-turn usage into a small table, apply unit prices, and show a running today/this-month estimate by provider on the Dashboard. It's an *estimate* (authoritative numbers live on each provider's own dashboard). Current default stack and reference unit prices (2026-08, check PROVIDERS.md before trusting these — they've already changed twice this month): Gemini 3.5 Flash-Lite (LLM) — check aistudio.google.com for current rate; Murf Falcon 2 (TTS) — $10/million characters; Smallest AI Pulse Pro (STT) — $0.004/minute; ElevenLabs (Romanian TTS fallback + Scribe v2 STT fallback) — per-character/per-minute on plan credits; Railway ~$5/mo flat + usage.

## Mobile / native shipping

- [ ] **Native / Capacitor migration.** Would fully fix mic permission (one-time OS grant, all browsers) and give reliable speech via Apple's `SFSpeechRecognizer` + explicit audio-session control. Does NOT fix latency by itself. Cost: App Store friction + loss of instant deploy (Capacitor mitigates via OTA JS updates), device toolchains; backend unchanged. Recommended path if web STT ever proves unfixable: **Capacitor** (wraps the existing React app). Don't full-rewrite.

## Product ideas

- [ ] **Online nutrition lookup — deliberately not now.** A web search per food adds seconds of latency to a live voice turn plus per-search cost, and the problem foods that motivated this (homemade/butcher dishes) aren't in databases anyway — model knowledge + deterministic math is the real lever. Revisit only if branded/packaged foods with barcodes/labels become a frequent use case.

## Engineering hygiene

- [ ] **Cover the voice pipeline's actual ordering guarantees — permission before speech, echo-guard epochs, no listening while the AI talks.** Playwright infrastructure now exists (`web/e2e/`, shipped 2026-08-31 — `npm run test:e2e`), with auth and navigation smoke tests as the foundation, but these specific state-machine guarantees still aren't covered: they need `getUserMedia`/`MediaRecorder`/`AudioContext` mocked realistically enough to actually drive `SpeechCapture`'s real state transitions, not just stubbed to unblock rendering (see `e2e/helpers.ts`'s `/greeting` stub for the difference — that's a network stub, this needs a believable fake device). Real, separate work — the mock shapes need to be right or the tests pass for the wrong reasons.

## Deployment

- [ ] **Postgres.** Still on SQLite. Fine for the current scale; revisit only if multi-device write contention ever becomes a real issue.

## Security

- [ ] **Rotate every API key that's been pasted into chat.** Anthropic and ElevenLabs from initial setup, plus Gemini, Murf, and Smallest AI from the 2026-08-28 provider work — all five should be treated as exposed. Regenerate at each provider's console (console.anthropic.com, elevenlabs.io, aistudio.google.com, murf.ai, smallest.ai), then update `.env` and the Railway env vars. The ElevenLabs key is already scoped to Text-to-Speech only, which limits the blast radius if it leaks further, but rotation is still the right move for all of them.
