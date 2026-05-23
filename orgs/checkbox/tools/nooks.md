# Nooks — Signal Dictionary

**Category:** AI-assisted calling (parallel dialer, virtual salesfloor)
**Role in stack:** SDR top-of-funnel productivity — parallel-dial cold lists, shared voice/video floor, AI call summaries.
**Integration surface:** Native Salesforce sync (calls, dispositions, recordings, AI summaries written as Task/Activity records); Salesloft/Outreach sync; HubSpot sync; limited public webhook/REST surface — no published developer portal as of 2026.
**Pricing/access reality:** Newer product (founded ~2021, Series A 2023). API/webhook access is gated and arranged per-customer via CSM, not self-serve. Salesforce is the realistic system of record for downstream consumers.

## What it emits
Per-call records (connect/no-connect, disposition, duration, recording URL), AI-generated post-call summaries and topic tags, and salesfloor coaching events. In practice, nearly all of this lands in Salesforce as Task activity with custom fields populated by the Nooks managed package — that's where Dugout should read from, not from Nooks directly.

## Wedge alignment honesty
Nooks is an SDR-stage tool; the Checkbox wedge ("Selected Vendor" → procurement stall) is AE/late-stage. Direct relevance is low — these signals are secondary to Gong/Dock/HubSpot. The value here is account-level *org-change detection* via dialing patterns, which can promote an awareness-tier signal on accounts already in late stages.

## Signals we'd extract

### 1. Connect-rate cliff on a named account — ACTION
- **What it is:** Sudden drop in pickup rate (>50% week-over-week) across multiple known contacts at a target account.
- **Why for the wedge (or for pipeline coverage):** Indicates layoffs, reorg, or champion departure — exactly the kind of internal turbulence that stalls Selected Vendor deals before procurement signs.
- **Rule shape:** `account.connect_rate_7d < 0.5 * account.connect_rate_28d AND attempts_7d >= 5 AND stage IN ('Selected Vendor','Proposal','Negotiation')` → ACTION; same condition on earlier stages → AWARENESS.
- **Source fields:** Salesforce Task (Nooks-written): `Status`, `CallDisposition`, `CallDurationInSeconds`, `WhoId`, `AccountId`, `ActivityDate`.

### 2. "Wrong person / no longer here" disposition cluster — ACTION
- **What it is:** >=2 calls in 14 days to distinct contacts at the same account returning "not at company" / "wrong number" / "left the company" dispositions.
- **Why for the wedge (or for pipeline coverage):** High-precision champion-departure or org-change signal. On a Selected Vendor account, this is BLOCKING-adjacent; the champion may already be gone.
- **Rule shape:** Count of Tasks where `CallDisposition IN ('No Longer There','Wrong Contact','Left Company')` grouped by AccountId, 14d window, >=2 → ACTION (BLOCKING if contact is mapped Champion in HubSpot/SFDC).
- **Source fields:** Salesforce Task `CallDisposition`, `WhoId` → Contact, Contact `Title`, optional HubSpot `champion_flag`.

### 3. Competitor / evaluation mention in AI summary — AWARENESS
- **What it is:** Nooks' post-call AI summary contains tokens matching a competitor list or phrases like "evaluating vendors", "RFP", "shortlist".
- **Why for the wedge (or for pipeline coverage):** Confirms an active eval is underway — useful for stage hygiene and for cross-referencing Gong mentions on the same account.
- **Rule shape:** Regex/keyword match against summary text field; emit AWARENESS, attach snippet, dedupe vs. Gong-sourced mentions of the same competitor on the same account within 7d.
- **Source fields:** Salesforce Task `Description` (where Nooks writes the summary) or custom `Nooks_AI_Summary__c` field.

## What we'd ignore
- Individual SDR coaching metrics (talk ratio, filler words, monologue length)
- Salesfloor presence/activity events
- Raw transcripts (too noisy; rely on AI summary)
- Dial volume per rep, leaderboard data
- Voicemail drop counts

## Effort to wire
- **Adapter LOC estimate:** ~100 LOC (it's just a SOQL query against Task with Nooks-specific filters).
- **Time estimate:** Half a day if Salesforce adapter already exists; 1 day standalone.
- **Hardest part:** Confirming which custom fields the Checkbox Nooks package writes to — varies per install. No public schema.

## Open questions
1. Does Checkbox's Nooks package write AI summaries to standard `Description` or a custom `Nooks_AI_Summary__c` field?
2. Is there a customer-accessible webhook for real-time disposition events, or is Salesforce polling the only path?
3. Are call recordings/transcripts retrievable via API, or only via the Nooks UI?
4. Does Nooks expose account-level aggregates, or must Dugout compute connect-rate cliffs itself from raw Task rows?
