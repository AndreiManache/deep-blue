# Deep Blue — Monetization & Pricing Reference

Analysis done 2026-08-28, right after the provider-cost overhaul (Gemini 3.5
Flash-Lite + Murf Falcon 2 + Smallest AI Pulse Pro — see [PROVIDERS.md](PROVIDERS.md)).
Numbers here are a planning model, not a guarantee — see "What's an assumption
vs. a measurement" at the end before leaning on any single figure.

**Before any of this applies**: there is currently no subscription billing in
the codebase at all — no Stripe/payment integration, no paywall, no plan
gating. This document is the pricing *strategy* to build toward; the billing
*infrastructure* is a separate, not-yet-started engineering task (logged in
BACKLOG.md).

## 1. Cost basis (recap from the 2026-08-28 provider work)

Per voice turn (user speaks → transcribed → LLM decides+replies → spoken
back), on the current default stack (Gemini 3.5 Flash-Lite, Murf Falcon 2,
Smallest AI Pulse Pro):

| Turns/day | API cost/user/month |
|---|---|
| 2 (light) | $0.216 |
| 5 (medium — used as the baseline below) | $0.54 |
| 10 (heavy) | $1.08 |
| 20 (very heavy) | $2.16 |

Even at 20 turns/day, API cost is under half of a $5 subscription — usage
volume is not a real threat to margin at any price point considered here.

**Fixed monthly costs** (independent of user count): Railway ~$5,
ElevenLabs ~$6 (cheapest plan that unlocks STT API access — confirm this is
still true and still the cheapest tier before relying on it; ElevenLabs is
now only the Romanian-STT + fallback path, so this plan is mostly idle
capacity). Total ≈ $11/month ≈ €9.44. At the profit levels this doc
discusses, fixed costs are noise — they shift a user-count answer by 2-3
users, not a meaningful amount.

## 2. Payment processing — the part that's easy to forget

Assuming Stripe-like pricing (2.9% + $0.30 per successful charge — confirm
against your actual processor and whether EU-card rates differ):

| Billing | Charge | Processing fee | Fee as % of revenue |
|---|---|---|---|
| Monthly | $5.00 | $0.445 | **8.9%** |
| Annual, no discount | $60.00/yr | $2.04/yr ($0.17/mo) | 3.4% |
| Annual, "2 months free" discount | $50.00/yr | $1.75/yr ($0.146/mo) | 3.5% of the discounted price |

**Billing annually roughly halves processing drag as a % of revenue**,
regardless of whether you also discount for it — the $0.30 flat component of
the fee is what kills small, frequent charges. This is the single easiest
margin lever available and costs nothing to implement beyond offering an
annual plan at checkout.

## 3. Net margin per user, combined

Baseline: medium usage (5 turns/day, $0.54/mo API cost).

| Plan | Revenue/mo (equiv) | API cost | Processing | **Net margin/mo** | Margin % |
|---|---|---|---|---|---|
| Monthly @ $5 | $5.00 | $0.54 | $0.445 | **$4.02 (€3.45)** | 80.3% |
| Annual @ $60/yr, no discount | $5.00 | $0.54 | $0.17 | **$4.29 (€3.68)** | 85.8% |
| Annual @ $50/yr, discounted | $4.17 | $0.54 | $0.146 | **$3.48 (€2.99)** | 83.5% |

The discounted annual plan has *lower* absolute monthly profit than either
full-price option (you gave away ~17% of revenue for the discount) — its
real value isn't per-dollar margin, it's retention (see §4). Whether to
discount for annual is a retention-vs-margin tradeoff, not a free win.

## 4. Churn & LTV — framework, not a prediction

Deep Blue has zero real subscription data yet, so treat the numbers below
as *category benchmarks to plug your own numbers into later*, not a forecast
for this specific app:

- Fitness-app category monthly churn: **median 10-13%, average ~9.2%,
  top-quartile 4-6%** (2026 benchmarks).
- The category skews heavily toward annual: **68% of fitness-app
  subscriptions are annual**, not monthly — the market has already voted
  that annual works better here, likely for exactly the retention reason
  above.

LTV (lifetime gross profit per average subscriber) = net margin per month ÷
monthly churn rate. Illustrative range at $5/mo monthly billing:

| Churn scenario | LTV |
|---|---|
| Average (9.2%/mo) | ~$44 |
| Top-quartile (5%/mo) | ~$80 |
| Median-poor (13%/mo) | ~$31 |

**Track your own churn from day one** once real subscribers exist — this
range is wide enough that guessing wrong changes the right CAC/pricing
decision substantially.

## 5. Your acquisition plan (organic content — Higgsfield/TikTok/Instagram)

Organic content means **cash CAC is near-zero** — no ad spend, just video
creation time and whatever Higgsfield's own subscription costs (a small,
real fixed cost worth tracking, but likely dwarfed by even a handful of
paying users). This is a genuinely strong position: LTV/CAC ratios that
would be marginal with paid ads (where CAC for a $5/mo health app can easily
run $20-50+ per install) look excellent when CAC is close to $0.

Two things worth being honest with yourself about:
- **Organic-to-paid conversion is highly variable and hard to benchmark
  honestly** — don't anchor on a specific industry number here; nobody's
  funnel from "viral TikTok view" to "paying subscriber" is comparable to
  anyone else's. Instrument your own funnel (views → link clicks → signups →
  paid) the moment you launch, and let *your* numbers replace this section.
- **Cal AI — your closest AI-native comparable — was pulled by Apple in
  April 2026 for deceptive paywall design and manipulative subscription
  flows.** Whatever pricing you land on, keep the paywall and cancellation
  flow honest. It's also just good practice for word-of-mouth, which is the
  entire point of an organic-content strategy.

## 6. Market context — what comparable apps charge (2026)

| App | Monthly | Annual |
|---|---|---|
| Cal AI (photo-based, AI-native — closest comp) | $9.99 (range $5.99-$19.99 across sources) | $29.99-$39.99 |
| MyFitnessPal Premium (legacy, largest player) | $19.99 | $79.99 |
| MyFitnessPal Premium+ | $24.99 | $99.99 |

**$5/month is priced below the category**, including below the closest
AI-native comparable. That's not necessarily wrong for a launch price — see
§7 — but know that there's real headroom above $5 once you have traction and
testimonials to justify it, and that competitors have set consumer
expectations for this category well above $5.

## 7. Tax and structure — general orientation, not advice

Not something I can give you definitive guidance on — consult a Romanian
accountant before launch. The general shape of what you'll be dealing with:

- **EU VAT on digital B2C subscriptions**: selling a digital subscription to
  EU consumers generally requires charging VAT at *the customer's* country
  rate, not Romania's, and remitting it — the EU's One-Stop-Shop (OSS) scheme
  exists to make this a single filing instead of registering in every
  country. Stripe Tax handles this automatically for a fee; alternatively, a
  "merchant of record" like Paddle or Lemon Squeezy takes on all VAT/sales-tax
  compliance globally in exchange for a materially higher cut (~5% instead of
  Stripe's ~2.9%+$0.30) — a real tradeoff between margin and near-zero tax
  complexity that's genuinely worth considering as a solo founder.
- **Romanian income/corporate tax** on whatever profit you actually take —
  depends on your business structure (sole proprietor/PFA vs. an SRL
  company), which changes both the rate and what's deductible. Decide this
  with an accountant before you have real revenue, not after.

## 8. App Store distribution — a reason to stay web-first for now

Deep Blue is currently a web app with no native wrapper (Capacitor is a
possible future path — see BACKLOG.md — not built). Billing directly via
Stripe/web **entirely avoids Apple/Google's cut**. If you ever ship natively
and sell subscriptions through in-app purchase:

- Apple/Google take **30%** of subscription revenue by default, or **15%**
  under their respective Small Business Programs (revenue under $1M/year —
  which would certainly apply at launch).
- Even at 15%, that's roughly **double the drag of Stripe's ~2.9%+$0.30** —
  it would cut the monthly-billing margin in §3 from 80.3% to roughly 65%.

This is a real, concrete reason to keep billing on the web for as long as
possible, even if you eventually ship a native/Capacitor app for the mic
permission benefits already noted in BACKLOG.md — many apps solve this by
selling the subscription only through their website and having the native
app check that same account, sidestepping IAP entirely.

## 9. So: how many users, and what price?

Reference numbers at the originally-asked $5/month, monthly billing, medium
usage (net margin $4.02/user/month ≈ €3.45):

| Target monthly profit | Users needed |
|---|---|
| €2,000 | ≈ 583 |
| €10,000 | ≈ 2,903 |

Rule of thumb: **divide your EUR target by ~€3.45** (monthly billing) or
**~€3.68** (annual, no discount) — fixed costs are too small to matter at
these levels.

**Recommendation for launch**: $5/month is a reasonable *entry* price for a
new, unproven app building trust through organic content — underpricing
relative to established competitors is a legitimate way to reduce the
"is this worth trying" friction for a cold TikTok/Instagram viewer, especially
with no brand recognition yet. But per §6, you have real room to move up
(Cal AI's own range starts near $10) once you have retained users and
testimonials — and per §2/§3, pushing new signups toward an annual plan is
worth more to your margin than the specific monthly number you pick. A
concrete, defensible starting point: **$4.99/month or ~$39.99/year**
(matching category psychology — a visible "2+ months free" annual discount —
while still undercutting Cal AI's annual price), with a plan to revisit
pricing after the first few dozen real subscribers tell you something this
model can't.

## What's an assumption vs. a measured fact in this document

**Measured / directly verified**: the per-turn API cost figures in §1 (real
API calls against Gemini/Murf/Smallest AI, plus a real character-count
measurement of the system prompt), Railway/ElevenLabs base costs (from actual
account setup), the competitor prices in §6 (web search, 2026).

**Assumed, stated explicitly so you can swap in your own number later**: 5
turns/day as "medium" usage, Stripe-standard 2.9%+$0.30 processing (your
actual processor/region may differ), the $6/mo ElevenLabs tier being the
cheapest that unlocks STT (worth re-confirming), and every churn/LTV number
in §4 (category benchmarks, not Deep Blue's own data — there isn't any yet).
