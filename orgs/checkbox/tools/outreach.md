# Outreach — Signal Dictionary

**Category:** Sales engagement
**Role in stack:** AE/SDR sequence engine for outbound + multi-thread nurture; system of record for prospect-level engagement events (opens, clicks, replies, opt-outs, bounces).
**Integration surface:** REST API v2 (JSON:API spec), Webhooks (resource-scoped events), OAuth 2.0 (Authorization Code grant, refresh tokens, scope-per-resource).
**Pricing/access reality:** Outreach API access requires an Outreach plan that includes API (typically Professional+) and an OAuth app registered with the customer's instance. Webhooks are gated by `webhooks.all.read/write` scope. Rate-limited at 10k/hr per org.

## What it emits
Prospect + Account + Opportunity records with engagement counters (openCount, replyCount, clickCount, optedOut, bouncedAt). Mailings (per-send rows tied to Sequence + SequenceStep + Prospect) with delivery state transitions. Webhook events fire on `mailing.*`, `prospect.*`, `sequenceState.*`, and `opportunity.*` mutations — enough to compute per-persona engagement deltas in near-real-time without polling.

## Signals we'd extract

### 1. Champion reply latency decay — BLOCKING
- **What it is:** The contact mapped to `OpportunityContactRole.role='Economic Buyer'` or `'Champion'` on a Stage="Selected Vendor" opp stops replying to sequenced mail at their historical cadence.
- **Why for the wedge:** Champion going dark between verbal commit and procurement is THE Selected Vendor failure mode. Outreach sees it 1-3 weeks before Salesforce activity does.
- **Rule shape:** For prospects matched to champion contacts on opps in Selected Vendor: if rolling 14d median reply latency on `mailing.replied` > 5d AND prior 60d baseline < 24h AND last `prospect.replied` > 7d ago → fire.
- **Source fields:** `mailings.repliedAt`, `mailings.deliveredAt`, `prospects.id`, `prospects.emails`, `sequenceStates.state`, joined to SFDC `OpportunityContactRole` via email.

### 2. Buying-committee opt-out / bounce — BLOCKING
- **What it is:** Any contact on the opp's `OpportunityContactRole` (Finance, Legal, IT, Security, Procurement, Champion) hits `optedOut=true`, `optedOutAt` set, or `bouncedAt` set on an active Selected Vendor opp.
- **Why for the wedge:** Opt-outs from Finance/IT after they were looped in mean the deal review is over and the rep doesn't know yet. Bounces on Procurement = wrong contact, restart needed before quarter-end.
- **Rule shape:** Webhook `prospect.updated` where `optedOut` flipped false→true OR `bouncedAt` newly set, AND prospect.email ∈ opp.contact_roles where opp.stage='Selected Vendor' → BLOCKING Slack DM to AE owner within 5 min.
- **Source fields:** `prospects.optedOut`, `prospects.optedOutAt`, `prospects.bouncedAt`, `prospects.emails`, webhook payload `data.attributes.changed`.

### 3. Multi-thread activation at the account — ACTION
- **What it is:** A net-new prospect at the same `account.id` (not previously on any OCR) replies or clicks on a sequence while opp is in Selected Vendor — typically the deputy, exec sponsor, or new committee member surfacing.
- **Why for the wedge:** Expansion of the buying committee mid-deal is a *positive* signal worth instrumenting — the rep should add them to the OCR immediately and re-mirror collateral. Often the actual decision-maker reveals themselves here.
- **Rule shape:** `mailing.replied` OR `mailing.clicked` where prospect.accountId matches an open Selected Vendor opp's account AND prospect.email NOT in current OCR AND prospect.title regex matches `(VP|Director|Chief|Head of) (Finance|Legal|IT|Security|Ops|Procurement)` → ACTION task: "Add [name] to OCR + send committee primer."
- **Source fields:** `prospects.accountId`, `prospects.title`, `prospects.emails`, `mailings.state`, webhook `mailing.replied`.

## What we'd ignore
- Open events (Apple MPP + corporate link-scanners make opens noise; only count clicks/replies).
- Bot clicks from security gateways (Mimecast, Proofpoint) — filter by ua-string regex and sub-2s click-after-deliver.
- SDR-prospected leads not yet tied to an SFDC opp.
- Sequence enrollment/finish events without engagement deltas.
- Internal/test prospects (domain ∈ checkbox.legal).

## Effort to wire
- **Adapter LOC estimate:** ~350 LOC TS — OAuth handler, webhook receiver with HMAC verify, three resource pollers (prospects, mailings, sequenceStates), JSON:API relationship hydration helper.
- **Time estimate:** 1.5 days — half a day on OAuth + webhook handshake, half on the SFDC OCR join (the load-bearing piece), half on rule tuning against historical mailings.
- **Hardest part:** Mapping Outreach `prospect.email` → SFDC `Contact.Id` → `OpportunityContactRole` reliably. Reps create prospects with personal-domain aliases, contacts get merged, and OCR is notoriously under-maintained — without a clean join, every signal misfires.

## Open questions
- Does Checkbox enforce OCR hygiene at Selected Vendor gate, or do we need a fallback heuristic (account-domain match + title regex)?
- Are Chorus/Gong-synced reply events double-counted in Outreach `mailing.replied`, or only direct-from-Outreach sends?
- Webhook delivery SLA — is HMAC retry within 5 min reliable enough for BLOCKING-tier, or do we need a 60s reconciliation poll as backstop?
