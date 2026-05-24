# Nooks — Signal Dictionary

**Category:** AI-assisted outbound workspace (parallel dialer, AI dialer, virtual salesfloor, AI coaching, signals/enrichment).
**Role in stack:** SDR top-of-funnel productivity — parallel-dial cold lists, AI scripts/note-taking on live calls, shared voice/video salesfloor, post-call AI summaries.
**Pricing/access reality:** Newer product (founded ~2021, Series A 2023, Series B 2024). Public marketing site is heavy; public developer portal is thin — no published REST/webhook reference as of 2026-05. API/webhook access is gated and arranged per-customer through the Nooks CSM, not self-serve.

## Architecture — Salesforce-relay (read what Nooks writes)

**Dugout does not call Nooks directly.** Nooks' managed AppExchange package writes every call as a Salesforce **Task** (Activity) record on the related Contact/Lead and rolls up to the Account. Dispositions, call duration, recording URL, and the AI-generated post-call summary all land on that Task — either in standard fields (`Description`, `CallDisposition`, `CallDurationInSeconds`, `CallType`, `Status`) or in Nooks-installed custom fields (commonly prefixed `Nooks_*__c`, e.g. `Nooks_AI_Summary__c`, `Nooks_Recording_URL__c`, `Nooks_Sentiment__c`). Naming is install-specific.

This is the **same pattern as the Dock card**: a vendor with thin public APIs but a fat Salesforce footprint — Dugout reads the Salesforce side, not the vendor. The Salesforce adapter is already required for the wedge, so the marginal cost of adding Nooks is a SOQL filter, not a new integration.

## What Nooks emits (into Salesforce)

- Per-call **Task** rows: `Status` (Completed / No Answer / Busy), `CallDisposition` (vendor-configurable picklist: "Connected", "Voicemail", "Wrong Number", "No Longer There", "Not Interested", "Callback", "DNC"…), `CallDurationInSeconds`, `ActivityDate`, `WhoId` (Contact/Lead), `WhatId` (Account/Opp), `OwnerId` (rep).
- **AI summary** of the call in `Description` or a custom long-text field.
- **Recording URL** in a custom field (Nooks hosts the audio; the URL is auth-gated to Nooks SSO).
- Optional **sentiment / topic tags** as custom picklist or multi-select fields when the customer has AI Coaching enabled.
- Salesfloor presence/coaching events stay inside Nooks UI and are **not** reliably written to Salesforce — ignore.

## Wedge alignment honesty

Nooks is SDR-stage; the Checkbox wedge ("Selected Vendor" → procurement stall) is AE/late-stage. Direct relevance is lower than Gong/Dock/HubSpot. The value here is **account-level org-change detection via dialing patterns** — when an account is already in late stages, a sudden change in Nooks-sourced connect behavior is one of the earliest leading indicators that a champion has left or a reorg is underway. Treat Nooks signals as confirmatory/escalation evidence on late-stage accounts, not as primary signals.

## Signals we'd extract

### 1. Connect-rate cliff on a named account — ACTION
- **What it is:** Sudden drop in pickup rate (>50% week-over-week) across multiple known contacts at a target account.
- **Why for the wedge:** Indicates layoffs, reorg, or champion departure — the kind of internal turbulence that stalls Selected Vendor deals before procurement signs.
- **Rule shape:** `account.connect_rate_7d < 0.5 * account.connect_rate_28d AND attempts_7d >= 5 AND stage IN ('Selected Vendor','Proposal','Negotiation')` → ACTION; same condition on earlier stages → AWARENESS.
- **Source fields:** Salesforce Task (Nooks-written): `Status`, `CallDisposition`, `CallDurationInSeconds`, `WhoId`, `AccountId` (via Contact/Lead → Account), `ActivityDate`.

### 2. "Wrong person / no longer here" disposition cluster — ACTION (BLOCKING when champion-mapped)
- **What it is:** >=2 calls in 14 days to distinct contacts at the same account returning "Not at Company" / "Wrong Number" / "Left the Company" dispositions.
- **Why for the wedge:** High-precision champion-departure / org-change signal. On a Selected Vendor account this is BLOCKING-adjacent — the champion may already be gone.
- **Rule shape:** Count of Tasks where `CallDisposition IN ('No Longer There','Wrong Contact','Left Company')` grouped by AccountId, 14d window, >=2 → ACTION. Promote to **BLOCKING** if any matched `WhoId` is flagged Champion in HubSpot or carries a Champion role on the Opportunity Contact Role.
- **Source fields:** Task `CallDisposition`, `WhoId` → Contact, Contact `Title`, HubSpot `champion_flag` (or SFDC `OpportunityContactRole.Role = 'Champion'`).

### 3. Competitor / evaluation mention in AI summary — AWARENESS
- **What it is:** Nooks' post-call AI summary contains tokens matching a competitor list or phrases like "evaluating vendors", "RFP", "shortlist", "POC with <competitor>".
- **Why for the wedge:** Confirms an active eval. Useful for stage hygiene and for cross-referencing the same mention in Gong on the same account.
- **Rule shape:** Regex/keyword match against the summary text field; emit AWARENESS, attach snippet, dedupe vs. Gong-sourced mentions of the same competitor on the same account within 7d.
- **Source fields:** Task `Description` (standard) or `Nooks_AI_Summary__c` (custom long-text) — whichever the install populates.

## What we'd ignore

- Individual SDR coaching metrics (talk ratio, filler words, monologue length).
- Salesfloor presence / "who's listening" events.
- Raw transcripts (too noisy; rely on AI summary).
- Dial volume per rep, leaderboards.
- Voicemail-drop counts.
- AI roleplay / scorecards / battlecard usage data.

## Effort to wire

- **Adapter LOC estimate:** ~100 LOC. It's a SOQL query against `Task` filtered to Nooks-sourced rows (typically `CallType != null AND CreatedById IN (<Nooks integration users>)` or a custom `Nooks_Source__c = TRUE` flag).
- **Time estimate:** Half a day if the Salesforce adapter already exists; 1 day standalone.
- **Hardest part:** Discovering which custom fields the Checkbox Nooks package writes to — varies per install (see below).

## Install-time discovery

Concrete steps the Dugout adapter runs at setup against the prospect's Salesforce org. No vendor support needed.

1. **Discover Nooks custom fields on Task** — run `DESCRIBE Task` via Tooling API or `SELECT QualifiedApiName FROM EntityParticleDefinition WHERE EntityDefinition.QualifiedApiName = 'Task' AND QualifiedApiName LIKE 'Nooks%'`. Map the discovered set against expected names: `Nooks_AI_Summary__c`, `Nooks_Recording_URL__c`, `Nooks_Disposition__c`, `Nooks_Sentiment__c`, `Nooks_Call_ID__c`, `Nooks_Source__c`. Persist the resolved field-name map per tenant.
2. **Locate AI summary field** — if `Nooks_AI_Summary__c` is absent, sample the most recent 50 Nooks-sourced Tasks and check whether `Description` contains the Nooks summary header (commonly `"## Call Summary"` or `"AI Summary:"`). Configure the regex accordingly.
3. **Resolve the disposition picklist** — `DESCRIBE` the `CallDisposition` field on Task and pull the picklist values; map the tenant's actual labels onto the canonical set used by signals 1 and 2 (`No Longer There`, `Wrong Contact`, `Left Company`, `Connected`, `Voicemail`).
4. **Identify Nooks-written rows** — find the integration user(s): `SELECT Id, Name FROM User WHERE Name LIKE '%Nooks%' OR Username LIKE '%nooks%'`. Use that User Id set as the `CreatedById` filter to scope Task queries to Nooks activity.
5. **Confirm Account rollup path** — Nooks writes Tasks against Contact or Lead; the AccountId is reached via `Task.WhoId → Contact.AccountId` (or `Task.WhatId` when set). Verify the install populates one or both, and prefer `WhatId` when present.
6. **Polling cadence** — default to a 15-minute SOQL poll on `LastModifiedDate > :since` against Task. If the tenant has Nooks webhooks enabled (per-customer toggle via CSM), swap to event-driven; otherwise polling is the contract.
