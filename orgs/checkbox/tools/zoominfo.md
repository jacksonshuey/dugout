# ZoomInfo — Signal Dictionary

**Category:** Prospecting / enrichment / intent
**Role in stack:** Authoritative people + company graph; primary feed for champion job changes and account-level intent surges
**Integration surface:** REST API (`api.zoominfo.com`) — Enrich, Search, Intent, Scoops, WebSights endpoints; PKI/JWT auth (username + client_id + private_key → short-lived bearer); no native webhooks, polling only
**Pricing/access reality:** API access is a paid add-on on top of seat licenses; Intent is a separate SKU (Streaming Intent costs meaningfully more than weekly batch); Scoops/news and WebSights are also gated SKUs. Rate limits per endpoint, daily credit caps on Enrich. Assume Checkbox already pays for the full Advanced+ bundle since they list ZoomInfo in stack.

## What it emits
Contact + company enrichment (titles, direct dials, mobile, email, tenure, seniority), technographic detection, Scoops (funding, layoffs, hiring plans, exec moves, M&A), Intent surge scores against ~14k bidstream topics, org chart deltas, and WebSights account-level web visitor de-anonymization. Job change detection runs on ZI's people graph (tenure + currentCompany churn) and is queryable via `/search/contact` with `lastUpdatedDate` + `jobStartDate` filters.

## Signals we'd extract

### 1. Champion job change — BLOCKING
Direct feed for the existing `champion_departure` playbook in `src/data/playbooks.ts` — this is the canonical trigger.
- **What it is:** Daily poll of `/search/contact` for any `contactId` in our champion map; flag when `currentCompany.id != prior employer id` OR `jobStartDate` within last 30 days
- **Why for the wedge:** Champion leaving between "Selected Vendor" and procurement is the textbook way Checkbox deals die. ZI sees it 2-6 weeks before LinkedIn updates surface in HubSpot
- **Rule shape:** `IF zi.contactId IN open_opportunity.champions AND (zi.currentCompany.id != opp.account.zi_id OR zi.jobStartDate > now - 30d) THEN fire(champion_departure, severity=BLOCKING, assignee=opp.owner)`
- **Source fields:** `contactId`, `currentCompany.id`, `jobStartDate`, `previousJobs[0]`, `jobTitle`, `managementLevel`

### 2. Intent surge on ICP no-pipeline accounts — ACTION
- **What it is:** Streaming Intent API filtered to topics: "contract lifecycle management", "legal operations", "matter management", "e-signature", "vendor management" with `surgeScore >= 75` for 3+ consecutive days
- **Why for the wedge:** Catches accounts entering active eval before they hit an SDR list. Surfaces them to AE before a competitor's BDR books the demo
- **Rule shape:** `IF account.firmographics MATCHES ICP AND account NOT IN open_pipeline AND intent.surgeScore >= 75 FOR >= 3d THEN fire(intent_surge_cold, severity=ACTION)`
- **Source fields:** `companyId`, `topic`, `surgeScore`, `signalDate`, `domain`

### 3. New economic buyer hired — ACTION
- **What it is:** Scoops API filtered to `category=ExecutiveMove` joined to open opps where the new hire's title matches buyer roles (GC, VP Legal, Chief Legal Officer, Head of Legal Ops, CFO, CIO)
- **Why for the wedge:** New exec = new champion opportunity OR new blocker. Especially load-bearing on stalled deals where original champion went dark
- **Rule shape:** `IF scoop.type='ExecutiveMove' AND scoop.companyId IN (open_opps.account_ids ∪ closed_lost_last_180d) AND scoop.newHire.title MATCHES buyer_titles THEN fire(new_buyer_arrived, severity=ACTION)`
- **Source fields:** `scoopId`, `companyId`, `personId`, `jobTitle`, `managementLevel`, `scoopDate`

### 4. WebSights anonymous visit on target account — AWARENESS
- **What it is:** WebSights API daily pull; flag when an account in pipeline (not just any visitor) hits pricing, security, or integrations pages
- **Why for the wedge:** Confirms multi-threaded research is happening even when the champion goes quiet. Feeds digest, not paging
- **Rule shape:** `IF websights.companyId IN open_opps AND visited_url IN [/pricing, /security, /integrations] AND visitor.companyId != opp.account.id_of_known_contacts THEN fire(stealth_research, severity=AWARENESS)`
- **Source fields:** `companyId`, `pageUrl`, `visitDate`, `pageViews`

## What we'd ignore
- Routine firmographic refreshes (employee count tick from 247 → 251) — pure noise
- Intent topics outside ICP-adjacent themes — surge scores on "salesforce administration" mean nothing for Checkbox
- Low-confidence intent (`surgeScore < 60`) — false positive rate too high to action
- New-hire Scoops below Director level — not buyer-relevant
- Funding round Scoops (HubSpot already has this via Crunchbase, no need to dual-source)

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC (auth/JWT refresh ~50, contact-poll for champions ~80, intent stream ~70, scoops ~50)
- **Time estimate:** 1.5 days for champion-change only; 3-4 days for all four signals with proper dedup
- **Hardest part:** Attribution — ZI's `companyId` ≠ Salesforce account id. Need an id-mapping table built from first-touch enrichment, and a fallback domain match. Intent has known false-positive issues on shared-IP accounts (agencies, MSPs) that need a denylist

## Open questions
- Does Checkbox's current ZI contract include the Intent SKU and Streaming tier, or weekly batch only? (Massively changes signal latency)
- WebSights coverage % for sub-200-employee accounts — historically thin
- Is `contactId` stable across job changes, or does ZI mint a new one when the person moves? (Determines whether champion-tracking joins on `contactId` or `email + lastName`)
