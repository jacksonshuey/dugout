# Gong — Signal Dictionary

**Category:** Conversation intelligence (Chorus → Gong, migration in progress)
**Role in stack:** Source of truth for what was actually said on sales calls — the only system that knows whether champions are wavering, competitors are creeping in, or next steps were ever committed. For the Selected-Vendor wedge, Gong is the single best leading indicator we have, because the death pattern is verbal before it's structural.
**Integration surface:** Public API v2 (REST, Bearer-token OAuth 2.0 with scopes like `api:calls:read:extensive`, `api:calls:read:media-url`, `api:data-privacy:delete`); Automation Rules → Webhook delivery on `call.created` (fires once call processing completes and the call appears in the library — typically minutes-to-hours post-call, per Gong's "Payload sent to webhooks" doc); Trackers configured per-tenant in the Gong UI and queryable via `/v2/settings/trackers`.
**Pricing/access reality:** Default rate limit is **3 req/sec and 10,000 calls/day per company**, returning HTTP 429 with `Retry-After` when exceeded (Gong "What the Gong API provides"). Limits can be raised by emailing help@gong.io. API access is part of Gong's standard offering on most modern contracts but is gated by the workspace admin enabling it under Settings → API — confirmed at install rather than assumed. Tracker definitions are tenant-owned, so the adapter must resolve tracker IDs at install time and reconcile nightly rather than hardcode names.

## What it emits
- **Call records and metadata** via `POST /v2/calls/extensive` (filter by `callIds[]`, `fromDateTime`, `toDateTime`, `primaryUserIds[]`, `workspaceId`) with a `contentSelector.exposedFields` toggle map controlling what comes back: `content.{brief,outline,highlights,keyPoints,callOutcome,trackers,trackerOccurrences,topics,pointsOfInterest,structure}`, `interaction.{speakers,questions,personInteractionStats,video}`, `parties`, `media`, `collaboration.publicComments`.
- **AI-generated call content** (brief, outline, key points, call outcome / next steps) — surfaced through `/v2/calls/extensive` with the `content.brief`, `content.outline`, `content.keyPoints`, and `content.callOutcome` flags set to `true`. Note: `pointsOfInterest.actionItems` was deprecated on 2025-01-23, so we rely on `callOutcome` for committed next steps rather than the legacy action-items field (Gong: "Public API change: Deprecating Call Action Items in the extensive endpoint").
- **Trackers** — both **Keyword Trackers** (exact phrase / regex matching) and **Smart Trackers** (AI concept detection over vector embeddings, trained on 500–1,500+ example calls per the Smart Tracker FAQs). API exposes tracker hits as `content.trackers[].occurrences[]` with `speakerId` and timestamp, retrievable via `/v2/settings/trackers` for the tenant catalog.
- **CRM context** — `context[].objects` returns linked Salesforce Opportunity records (including `StageName`, `Amount`, `CloseDate`, `Id`) when the Gong↔Salesforce integration is wired (Gong: "Gong for Salesforce app object fields").
- **Participants** — `parties[]` with `emailAddress`, `name`, `title`, `affiliation` (`Internal` / `External` / `Unknown`), `speakerId` for transcript joining.
- **Webhook payloads** — Automation Rule fires `{callData, isTest}` JSON when a matching call finishes processing; `callData` mirrors the `/v2/calls/extensive` response shape (Gong: "Payload sent to webhooks").
- **Data-privacy endpoints** — `POST /v2/data-privacy/erase-data-for-email-address` and `/v2/data-privacy/erase-data-for-phone-number` for GDPR/CCPA delete requests; scope `api:data-privacy:delete`.

## Signals we'd extract

### 1. No next step committed — BLOCKING
- **What it is:** Call ends on a Selected Vendor deal with zero entries in `content.callOutcome` next-steps language **and** no tracker hit on the tenant's `Next Steps` Smart Tracker attributed to a rep speaker.
- **Why for the wedge:** Gong Labs' own research finds close rates **drop 71% when next steps aren't discussed on the first call**, and the fastest-closing deals spend **53% more time on next steps** in the first meeting than average deals ("The Most Important Steps of a Sales Call", "Accelerate Your Sales Cycle"). At Selected Vendor stage, a call with no committed next step is the literal verbal signature of the wedge — the deal is drifting toward the Procurement handoff with no forcing function.
- **Rule shape:** `call.created` webhook (Automation Rule filtered to `Opportunity.StageName == "Selected Vendor"`) → fetch `POST /v2/calls/extensive` with `filter.callIds=[id]` and `contentSelector.exposedFields.content.{brief,callOutcome,trackers,trackerOccurrences}=true`, `parties=true` → if `callOutcome` next-steps list is empty/absent AND no `trackers[name="Next Steps"].occurrences[]` with `speakerId` mapping to an Internal party AND `metaData.duration > 900` (15 min) → BLOCKING task to AE within 1 hour.
- **Source fields:** `content.callOutcome`, `content.trackers[].occurrences[].speakerId`, `parties[].affiliation`, `context[].objects.opportunity.StageName`, `metaData.duration`.

### 2. Buying committee gap — ACTION
- **What it is:** Last 3 calls on a Selected Vendor opp have ≤2 distinct external participants and none with titles matching Finance / Legal / IT / Procurement / Security regexes.
- **Why for the wedge:** Gong's "Sales Stats" research: **selling teams on closed-won deals are 67% larger than on closed-lost deals**, and bringing in a sales engineer / technical resource lifts win rates by up to 30%. For Checkbox specifically, the deal dies at contract review when Finance/IT enters cold — if Gong shows we're still single-threaded to the champion 14 days into Selected Vendor, MEDDPICC's Economic Buyer + Champion-of-Champion are missing and the wedge is forming.
- **Rule shape:** Nightly batch — for each open Selected Vendor opp, `POST /v2/calls/extensive` with `filter.fromDateTime` = opp.stageEnteredAt and `filter.workspaceId`, paginated by `cursor`. Pull `parties[]` where `affiliation == "External"`, dedupe by lowercased `emailAddress`, regex `title` against `FINANCE_IT_LEGAL_PROCUREMENT_TITLES` (e.g., `/cfo|controller|finance|legal|counsel|procurement|cio|ciso|it director|security/i`). Zero matches across the last 3 calls = ACTION.
- **Source fields:** `parties[].title`, `parties[].emailAddress`, `parties[].affiliation`, `context[].objects.opportunity.Id`.

### 3. Competitor mention late-stage — ACTION
- **What it is:** Tracker hit on a competitor name (Ironclad, LinkSquares, ContractWorks, SpotDraft, Concord, Agiloft) **spoken by an External party** on a Selected Vendor or Negotiation call.
- **Why for the wedge:** Champion saying "we're also looking at Ironclad" at Selected Vendor stage means the bake-off has reopened. Gong's "Best Sales Insights" data shows competitor mentions in late-stage calls correlate strongly with stalls. AE needs to know today, not in Monday's pipeline review.
- **Rule shape:** At install, `GET /v2/settings/trackers` → cache `{trackerId, name}` for our `COMPETITOR_LIST`. Subscribe a webhook Automation Rule on `New call processed` (no stage filter — the webhook is cheap). On receipt, walk `content.trackers[]` where `id ∈ competitorTrackerIds`; for each `occurrences[]`, resolve `speakerId → parties[].affiliation`. If external speaker AND `context[].objects.opportunity.StageName ∈ {"Selected Vendor", "Negotiation"}` → ACTION + transcript snippet ±30s around `occurrences[].start`.
- **Source fields:** `content.trackers[].id`, `content.trackers[].name`, `content.trackers[].occurrences[].{speakerId,start}`, `parties[].{speakerId,affiliation}`, `context[].objects.opportunity.StageName`.

### 4. Champion sentiment / engagement cliff — AWARENESS
- **What it is:** Same external contact's `interaction.speakers[].talkTime` or sentiment trend drops sharply call-over-call on the same opp.
- **Why for the wedge:** Champion disengagement is verbal before it's structural — the champion who used to drive 40% of the conversation and now sits at 10% is cooling. Gong's research on high-vs-low performer consistency (low performers' talk swings 10% between won/lost deals) supports this as a leading indicator. Not actionable enough for BLOCKING, but worth the AE's morning digest before their next call.
- **Rule shape:** Per opp, group calls by participant `emailAddress`, compute delta on `interaction.speakers[].talkRatio` (and sentiment where available). Threshold: >25% relative drop with minimum 10 min speaking time in both calls to avoid noise. Use `contentSelector.exposedFields.interaction.{speakers,personInteractionStats}=true`.
- **Source fields:** `interaction.speakers[].talkTime`, `interaction.speakers[].talkRatio`, `interaction.personInteractionStats`, `parties[].emailAddress`.

## What we'd ignore
- Rep-coaching metrics (longest monologue, filler-word counts, patience score, question rate) — coaching signals, not deal signals.
- Call volume / activity counters — already in Salesforce Activity and easier to query there.
- Gong's own "Deal Health" composite score — opaque, can't explain to a rep why it changed, not a defensible BLOCKING trigger.
- Generic positive-sentiment flags without speaker + stage context — too noisy.
- Email and Outreach engagement events that Gong also surfaces — those signals belong to the Outreach card; Gong is the call-content lane.

## Effort to wire
- **Adapter LOC estimate:** ~450 LOC — webhook receiver with HMAC verification, paginated `/v2/calls/extensive` client with cursor handling and `Retry-After` backoff, tracker-ID resolver via `/v2/settings/trackers`, four rule evaluators.
- **Time estimate:** 2-3 days for signals 1-3; signal 4 adds a day for the rolling per-participant baseline.
- **Hardest part:** Tracker IDs are per-tenant and frequently renamed — adapter needs an install-time sync plus nightly reconciliation, and a fallback that matches by tracker `name` when an ID lookup fails. Second hardest: webhook latency means "BLOCKING within 1 hour" is the real SLA, not real-time — set rep expectations accordingly. Third: Smart Trackers require 500–1,500 training calls before they're reliable, so on greenfield tenants we fall back to Keyword Trackers and tune later.

## Install-time discovery
- **Tracker IDs (tenant-specific):** map Checkbox's Gong workspace tracker catalog to our canonical `{next_steps, competitor_mention, pricing_objection, security_review, procurement_handoff}` set via `GET /v2/settings/trackers`. Confirm which are Keyword vs Smart Trackers (Smart Trackers have richer recall but require training data and tend to drift; treat them as advisory, not authoritative).
- **API access confirmation:** verify the workspace admin has enabled the Public API under Settings → API and minted credentials with the scopes `api:calls:read:extensive`, `api:calls:read:media-url`, `api:data-privacy:delete`. Confirm the company-level rate-limit ceiling (default 3 rps / 10K/day) is sufficient for our backfill plan or whether we need help@gong.io to raise it.
- **Chorus → Gong cutover plan:** confirm cutover date, whether historical Chorus calls are being imported into Gong or left in Chorus for read-only reference, and which opps have calls split across both systems during the transition window. Decide: do we (a) backfill Dugout signals from Chorus history via the Chorus API and re-emit, (b) start fresh at the Gong cutover date and accept a blind spot on pre-cutover deals, or (c) dual-source for the overlap period? Recommended default: (b), with a manual exception list for the top 10 in-flight Selected-Vendor deals.
- **Webhook Automation Rule provisioning:** decide whether Dugout creates the Automation Rule programmatically (Gong UI-only at install) or whether the Checkbox RevOps admin creates it from a runbook and shares the endpoint signing secret.
- **Salesforce context wiring:** confirm Gong↔Salesforce is configured so `context[].objects.opportunity.StageName` and `Id` are present on call payloads — without that link, signals 1–3 can't filter by stage and degrade to "all calls" noise.

---
*Sources: Gong Public API docs (`/v2/calls/extensive`, `/v2/settings/trackers`, `/v2/data-privacy/*`), Gong Help Center ("What the Gong API provides", "Payload sent to webhooks", "Create a webhook rule", "Understanding trackers", "Smart tracker FAQs", "Delete personal data"), Gong Labs blog ("The Most Important Steps of a Sales Call", "Accelerate Your Sales Cycle", "30 Mind-Blowing Sales Stats", "The best sales insights of 2025"), SwaggerHub `gong/public-api/2.0`.*
