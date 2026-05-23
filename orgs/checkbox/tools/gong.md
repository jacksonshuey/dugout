# Gong — Signal Dictionary

**Category:** Conversation intelligence (replacing Chorus)
**Role in stack:** Source of truth for what was actually said on sales calls — the only system that knows whether champions are wavering, competitors are creeping in, or next steps were ever committed.
**Integration surface:** Public API (REST, OAuth 2.0 + access key/secret), webhook subscriptions for call-ready events, Trackers API for keyword/topic config.
**Pricing/access reality:** Public API is gated to Enterprise tier customers; rate-limited to ~3 req/sec and 10K calls/day per workspace. Tracker definitions are tenant-owned, so adapter must read tracker IDs at install time rather than hardcode names.

## What it emits
Call recordings + speaker-diarized transcripts, Tracker hits (configured keyword/topic detectors with timestamps and speaker attribution), participant lists with CRM-matched contacts, deal-level engagement scores and call cadence, AI-extracted "next steps" and "action items," and per-call sentiment trends. Webhooks fire when a call is processed (~5-30 min post-call).

## Signals we'd extract

### 1. No next step committed — BLOCKING
- **What it is:** Call ends on a Selected Vendor deal with zero entries in Gong's `aiContent.callOutcome.nextSteps[]` AND no tracker hit on `next_steps` tracker from the rep.
- **Why for the wedge:** This is the wedge made literal. Champion-stage call with no committed follow-up = deal drifting toward "no decision." Most common death pattern at the Selected Vendor → Procurement handoff.
- **Rule shape:** `call.processed` webhook → fetch `/v2/calls/extensive` with `contentSelector.exposedFields.content.brief=true` → if `crm.opportunity.stage == "Selected Vendor"` AND `aiContent.nextSteps.length == 0` AND `call.duration > 15min` → BLOCKING task to AE within 1 hour.
- **Source fields:** `calls.extensive.aiContent.nextSteps`, `calls.extensive.context[].objects.opportunity.stage`, `calls.duration`.

### 2. Buying committee gap — ACTION
- **What it is:** Last 3 calls on a Selected Vendor opp have the same ≤2 external participants and no one with title matching Finance/Legal/IT/Procurement.
- **Why for the wedge:** Checkbox dies when Finance/IT enters at contract review. If Gong shows we're still talking to only the champion 14 days into Selected Vendor, MEDDPICC's Economic Buyer is missing — fixable if flagged early.
- **Rule shape:** Nightly batch: for each opp in Selected Vendor, query `/v2/calls` filtered by `opportunityId`, pull `parties[]` where `affiliation == "External"`, dedupe by `emailAddress`, regex titles against `FINANCE_IT_LEGAL_TITLES`. Zero matches across last 3 calls = ACTION.
- **Source fields:** `calls.parties[].title`, `calls.parties[].affiliation`, `calls.context[].objects.opportunity`.

### 3. Competitor mention late-stage — ACTION
- **What it is:** Tracker hit on competitor name (Ironclad, LinkSquares, ContractWorks, SpotDraft) spoken by an external participant on a Selected Vendor or Negotiation call.
- **Why for the wedge:** Champion saying "we're also looking at Ironclad" at Selected Vendor stage means the bake-off reopened. AE needs to know today, not in the Monday pipeline review.
- **Rule shape:** Subscribe to tracker IDs matching our `COMPETITOR_LIST` (resolved at install via `/v2/settings/trackers`). On hit: if `speakerId` resolves to `party.affiliation == "External"` AND opp.stage ∈ {Selected Vendor, Negotiation} → ACTION + transcript snippet ±30s of timestamp.
- **Source fields:** `calls.content.trackers[].occurrences[]`, `calls.content.trackers[].name`, `calls.parties[].speakerId`.

### 4. Champion sentiment cliff — AWARENESS
- **What it is:** Same external contact's sentiment score drops >25% call-over-call across two consecutive calls.
- **Why for the wedge:** Early warning of champion cooling — not actionable enough for BLOCKING but worth surfacing in the AE's morning digest before the next call.
- **Rule shape:** Per opp, group calls by participant email, compute delta on Gong's per-speaker sentiment. Threshold + minimum 10 min speaking time to avoid noise.
- **Source fields:** `calls.interaction.speakers[].sentiment`, `calls.parties[].emailAddress`.

## What we'd ignore
- Rep talk ratio, longest monologue, filler words ("um" counts) — coaching metrics, not deal signals.
- Call volume / activity counters — already in Salesforce.
- Gong's own "Deal Health" score — opaque, can't explain to a rep why it changed.
- Generic positive-sentiment flags — too noisy without speaker + stage context.

## Effort to wire
- **Adapter LOC estimate:** ~450 LOC (webhook receiver, `/v2/calls/extensive` client with pagination, tracker ID resolver, 4 rule evaluators).
- **Time estimate:** 2-3 days for signals 1-3; signal 4 adds a day for the rolling baseline.
- **Hardest part:** Tracker IDs are per-tenant and renamed often — adapter needs an install-time sync + nightly reconciliation. Second hardest: webhook latency means "BLOCKING within 1 hour" is the real SLA, not real-time.

## Open questions
- Does Checkbox's Gong contract include API access, or is it the standard package? (Enterprise add-on in some deals.)
- Are tracker definitions for competitors already configured, or do we own creating them?
- How does the Chorus → Gong migration handle historical calls — do we backfill signals or start fresh at cutover?
