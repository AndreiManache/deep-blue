# Deep Blue — Backlog

Ideas and open items to consider going forward. Shipped/completed work has been pruned — see git history for what's already done.

## Feedback-as-tickets & achievements (2026-08-29, user's idea)

- [ ] **v2: proactively notify the reporter when their feedback is resolved** — not just the passive "check the My Feedback screen" v1 shipped 2026-08-30 (see git history / PR: `resolution_note` column, admin can write a note per report, reporter's own read-only "My Feedback" screen shows status + note). A banner, or the greeting mentioning "that thing you reported got fixed," once real usage shows people actually want to be told rather than check manually. Also revisit Web Push at this point if it's still relevant — see the earlier "notification" conversation: works directly in-browser on Android/desktop, but on iOS only for a PWA added to the home screen. **Correction (2026-08-31):** an earlier version of this note claimed EU iOS users couldn't use home-screen PWAs at all due to Apple disabling them under the DMA. That was wrong — Apple announced that removal in Feb 2024 but publicly reversed it weeks later, and Home Screen web apps have remained available in the EU since. Verify against current iOS behaviour before relying on either claim, but do not treat "EU iOS PWAs are broken" as a given.
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

## User-reported feedback (2026-08-31 triage)

Went through every feedback report in the inbox (17 total, from Andrei/Maria/Daniel) and updated each one's status. Seven were already fixed by earlier work this session or a prior one — marked **completed** with a resolution note so the reporter sees it on their "My Feedback" screen: the BMR-formula question (Mifflin-St Jeor is already shown in Profile), the "Jurnal alimentar" Dashboard label, the spoken-calorie-mismatch bug, slow barcode scanning, the "send another feedback" button, swipe-back navigation, and — fittingly — the feedback-card system itself (title/description/status/archived section), which is literally what this report asked for. One report was test data (`Test2`) and was left as it already was. Everything else below is real, still open, and marked **reviewed** so it's no longer sitting in "new."

- [ ] **STT mishears a spoken number as an unrelated word — Andrei, 2026-08-27.** Transcript: "Number, number just registered as composer." Too vague to reproduce from the report alone (no idea what number, what food, or what exact word appeared instead of "composer"). Low priority unless it recurs with a clearer repro.
- [ ] **No way to favorite/quick-add frequently logged foods — Andrei, 2026-08-29.** Wants scanned or frequently-logged items (example given: milk, scanned twice in two days) saved as favorites for faster re-selection. Distinct from the existing personal food database, which is about calorie accuracy, not quick re-entry — confirmed no favorites/quick-add concept exists anywhere in the codebase yet. Real gap, not yet scoped.
- [ ] **Tap-to-talk failed once right after changing a language/pronunciation setting, worked on retry — Andrei, 2026-08-30.** Garbled transcript, exact setting unclear. Leading theory is a stale-connection race right after a settings change, but this needs a live repro before it's worth diagnosing further.
- [ ] **Can't select/log a specific food item — Maria, 2026-08-30.** Transcript is garbled beyond recognition ("oposa gata fukuta" — possibly a ready-made dish name in Romanian). Needs Maria to say the actual food name again before this is actionable.
- [ ] **Streamline the voice-logging conversation flow — Andrei, 2026-08-30 and 2026-08-31 (two related reports).** Wants the spoken greeting replaced with a short generic sound, the AI to just confirm a log tersely instead of narrating it back, and the full recap of what was eaten given only on request. A deliberate voice-UX redesign, not a bug — needs real scoping (what sound, exact confirmation wording, how "on request" triggers the recap) before building.
- [ ] **"AI failed to respond" — Andrei, 2026-08-31, after the turn-hang/cutoff fixes (PRs #20-23) already shipped 2026-08-28.** Since this report postdates those fixes, don't assume it's the same bug recurring — could be a new, distinct cause. Needs a live repro to diagnose.
- [ ] **Improve intent recognition between "what should I eat" advice and an actual food-logging request — Andrei, 2026-08-31.** In an otherwise-good conversation, the AI briefly logged a meal when Andrei was really just asking for a suggestion, then self-corrected. Worth reviewing the tool-call prompt/instructions for how it distinguishes an advice question from a log_food intent.

## Personal food database (2026-08-27)

- [ ] **Bigger, riskier idea, flagged honestly: skip the LLM call entirely for confident repeat foods, to actually reduce cost.** Important distinction from the above: the existing system already avoids trusting a *fresh guess* for known foods, but it does **not** currently save any LLM cost, because the model still runs its full reasoning on every turn regardless of whether the server ends up using its number — the expensive part is understanding the sentence ("I had two eggs and a coffee"), not guessing the calories. Actually bypassing the model for a turn is a real architecture change with real risk (misparsing a turn that only *sounds* like an exact repeat, e.g. missing "...and also skipped lunch" tacked onto what looks like a simple repeat). Worth exploring later — e.g. a narrow, high-confidence fast path for near-verbatim repeats of a personal favorite — but should be scoped and built as its own careful feature, not assumed to fall out of the database work above.

## Feedback & admin (from the friends-beta rollout, 2026-08-27)

- [ ] **Admin panel engagement analytics — the users-by-usage table shipped 2026-08-31, this is the next layer.** The admin panel now has a real home (users table: username, join date, all-time estimated spend) plus Feedback inbox/Models in use/Corrections consolidated into it — no longer just Railway SSH one-off queries. What's still missing is *behavior*, not spend: who's actually logging regularly vs. went quiet, days-since-last-entry per user, a simple retention view. Low priority until there's a real user base beyond the current handful to make trends meaningful.

## Performance & cost

- [ ] **Reduce voice-turn latency further — streaming and/or skip the second LLM call.** Deliberately deferred 2026-08-28 rather than bundled into the gemini-3.5-flash-lite switch, per explicit request to ship the safe win now and not rush a bigger architecture change: "deliver something good, not make mistakes." Two independent levers, either or both:
  - **Stream the reply into TTS** — speak the first sentence while the rest generates and/or streams from the TTS provider, instead of awaiting the full text then the full audio file. Biggest perceived-speed lever; real engineering lift (Murf's `/v1/speech/stream` endpoint already streams audio bytes — see `ttsMurf.ts` — the missing half is streaming the *LLM* output into it incrementally).
  - **Skip the second Gemini call for a logged turn.** Every log_food turn currently makes two sequential model calls: one to decide the tool call, one more to phrase the confirmation reply. Since the logged result is already known server-side after the tool runs, that confirmation could be templated (or a short deterministic sentence) instead of model-generated, roughly halving LLM latency again. Real tradeoff: loses the model's natural phrasing/personality in the reply, and needs a Romanian template too — a deliberate quality decision, not a free win.
  - Current baseline after the flash-lite switch (2026-08-28, measured, includes Murf TTS): ~3s/turn. Worth re-measuring on a real phone before deciding whether either lever is still worth the complexity.

## Mobile / native shipping

- [ ] **Native / Capacitor migration.** Would fully fix mic permission (one-time OS grant, all browsers) and give reliable speech via Apple's `SFSpeechRecognizer` + explicit audio-session control. Does NOT fix latency by itself. Cost: App Store friction + loss of instant deploy (Capacitor mitigates via OTA JS updates), device toolchains; backend unchanged. Recommended path if web STT ever proves unfixable: **Capacitor** (wraps the existing React app). Don't full-rewrite.

## Product ideas

- [ ] **Online nutrition lookup — deliberately not now.** A web search per food adds seconds of latency to a live voice turn plus per-search cost, and the problem foods that motivated this (homemade/butcher dishes) aren't in databases anyway — model knowledge + deterministic math is the real lever. Revisit only if branded/packaged foods with barcodes/labels become a frequent use case.

## Deployment

- [ ] **Postgres.** Still on SQLite. Fine for the current scale; revisit only if multi-device write contention ever becomes a real issue.

## Security

- [ ] **Rotate every API key that's been pasted into chat.** Anthropic and ElevenLabs from initial setup, plus Gemini, Murf, and Smallest AI from the 2026-08-28 provider work — all five should be treated as exposed. Regenerate at each provider's console (console.anthropic.com, elevenlabs.io, aistudio.google.com, murf.ai, smallest.ai), then update `.env` and the Railway env vars. The ElevenLabs key is already scoped to Text-to-Speech only, which limits the blast radius if it leaks further, but rotation is still the right move for all of them.
