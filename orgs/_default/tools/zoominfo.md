# ZoomInfo — Signal Dictionary

**Category:** Prospecting / enrichment / intent
**Role in stack:** Authoritative people + company graph; primary feed for champion job changes and account-level intent surges
**Integration surface:** REST API at `https://api.zoominfo.com` — Enrich, Search, Intent, Scoops, WebSights endpoint families. PKI/JWT auth: `POST /authenticate` with `username`, `client_id`, and a JWT signed by the customer's private key returns a bearer token with a ~60-minute TTL (see [Authentication](https://api-docs.zoominfo.com/#section/Authentication)). Username + password auth also exists but is deprecated for production. **No push webhooks** — every signal is polled.
**Pricing/access reality:** API access is a paid add-on on top of seat licenses. Intent is a separate SKU, and the Streaming Intent feed (daily, ~24-hour latency) costs meaningfully more than weekly batch. Scoops and WebSights are separately gated. Per-endpoint rate limits and daily credit caps apply to Enrich/Search (typical Advanced+ contract = 25–50k Enrich credits/month). The workspace lists ZoomInfo in stack; assume Advanced+ bundle but confirm SKU mix at install time.

## What it emits
Contact + company enrichment (titles, direct dials, mobile, work + personal email, tenure, seniority, `managementLevel`), technographic detection, Scoops (funding, layoffs, hiring plans, exec moves, M&A), Intent surge scores against ~14k bidstream-derived topics, org chart deltas, and WebSights account-level web visitor de-anonymization. Job change detection runs on ZI's people graph: the `id` returned by [Enrich](https://api-docs.zoominfo.com/#tag/Enrich) is **stable across employer changes** — that's the core promise of the people graph — and `hasMoved` / `lastUpdatedDate` / `jobStartDate` on [`/search/contact`](https://api-docs.zoominfo.com/#tag/Search) flag the transition. ZI typically surfaces a move 2–6 weeks before the contact updates LinkedIn.

## Signals we'd extract

### 1. Champion job change — BLOCKING
Direct feed for the existing `champion_departure` playbook in `src/data/playbooks.ts` — this is the canonical trigger.
- **What it is:** Daily `POST /search/contact` with `personIds = [our champion ids]` and `hasMoved = true` (alternative: filter `lastUpdatedDate >= today - 1d` then diff `currentCompany.id` against the stored value). Backstop nightly `POST /enrich/contact` on the same id set to catch any moves the search filter misses.
- **Why for the wedge:** Champion leaving between "Selected Vendor" and procurement is the textbook way these deals die. ZI sees it 2–6 weeks before LinkedIn updates surface in HubSpot, which is the window we need to redeploy CSM/AE attention before the deal dies in legal.
- **Rule shape:** `IF zi.id IN open_opportunity.champions AND (zi.currentCompany.id != opp.account.zi_company_id OR zi.jobStartDate > now - 30d) THEN fire(champion_departure, severity=BLOCKING, assignee=opp.owner)`
- **Source fields (Enrich response):** `id`, `currentCompany.id`, `currentCompany.name`, `jobTitle`, `managementLevel`, `jobStartDate`, `previousJobs[]` (each with `companyId`, `companyName`, `jobTitle`, `startDate`, `endDate`), `lastUpdatedDate`
- **Stability note:** `id` is the people-graph primary key — it persists across company changes, so the join is `zi.id == champion_map.zi_id` with no fallback needed. See [Enrich](https://api-docs.zoominfo.com/#tag/Enrich) contact schema.

### 2. Intent surge on ICP no-pipeline accounts — ACTION
- **What it is:** Poll [`/intent`](https://api-docs.zoominfo.com/#tag/Intent) (Streaming if SKU permits, otherwise weekly batch) filtered to the customer's vertical-specific topic allowlist (3–8 topics chosen at install time). Fire when `surgeScore >= 75` (scale is 0–100) for 3+ consecutive `signalDate` days.
- **Why for the wedge:** Catches accounts entering active eval before they hit an SDR list. Surfaces them to AE before a competitor's BDR books the demo.
- **Rule shape:** `IF account.firmographics MATCHES ICP AND account NOT IN open_pipeline AND intent.surgeScore >= 75 FOR >= 3 consecutive signalDate THEN fire(intent_surge_cold, severity=ACTION)`
- **Source fields:** `companyId`, `companyName`, `domain`, `topic`, `topicId`, `surgeScore`, `signalDate`, `signalStrength` (Low/Medium/High/VeryHigh categorical mirror of the numeric score)

### 3. New economic buyer hired — ACTION
- **What it is:** Poll [`/scoops`](https://api-docs.zoominfo.com/#tag/Scoops) filtered to `scoopType = "ExecutiveMove"` (or `scoopCategory = "PeopleChanges"`), joined to open opps where the new hire's title matches the customer's buyer-role list (e.g., CFO, CIO, plus any vertical-specific titles).
- **Why for the wedge:** New exec = new champion opportunity OR new blocker. Especially load-bearing on stalled deals where original champion went dark, and on closed-lost-180d revival.
- **Rule shape:** `IF scoop.scoopType = 'ExecutiveMove' AND scoop.companyId IN (open_opps.account_ids ∪ closed_lost_last_180d) AND scoop.contact.jobTitle MATCHES buyer_titles AND scoop.contact.managementLevel IN ['C-Level','VP-Level','Director'] THEN fire(new_buyer_arrived, severity=ACTION)`
- **Source fields:** `scoopId`, `scoopType`, `scoopCategory`, `companyId`, `companyName`, `contact.id`, `contact.firstName`, `contact.lastName`, `contact.jobTitle`, `contact.managementLevel`, `scoopDate`, `publishedDate`

### 4. WebSights anonymous visit on target account — AWARENESS
- **What it is:** Daily pull from [`/websights`](https://api-docs.zoominfo.com/#tag/WebSights) (typically `/websights/visits`); flag when an account in pipeline (not just any visitor) hits pricing, security, or integrations pages with visitors who are not in our known-contact set.
- **Why for the wedge:** Confirms multi-threaded research is happening even when the champion goes quiet. Feeds digest, not paging.
- **Rule shape:** `IF websights.companyId IN open_opps AND visited_url IN [/pricing, /security, /integrations] AND visitor IS NOT IN opp.known_contacts THEN fire(stealth_research, severity=AWARENESS)`
- **Source fields:** `companyId`, `companyName`, `pageUrl`, `visitDate`, `pageViews`, `sessionDuration`, `visitorLocation`

## What we'd ignore
- Routine firmographic refreshes (employee count tick from 247 → 251) — pure noise
- Intent topics outside ICP-adjacent themes — surge scores on out-of-category topics are noise for this workspace
- Low-confidence intent (`surgeScore < 60`, or `signalStrength = "Low"`) — false positive rate too high to action
- New-hire Scoops below Director `managementLevel` — not buyer-relevant
- Funding round Scoops (HubSpot already has this via Crunchbase, no need to dual-source)
- WebSights hits from companies on the shared-IP denylist (agencies, MSPs, ISPs) — unreliable attribution

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC (JWT mint + refresh ~50, `/search/contact` champion poll ~80, `/intent` poll + dedup ~70, `/scoops` poll ~50)
- **Time estimate:** 1.5 days for champion-change only; 3–4 days for all four signals with proper dedup and id-mapping
- **Hardest part:** Attribution. ZI's `companyId` ≠ Salesforce account id, so first-touch enrichment must populate `zi_company_id` on the account, with a domain-match fallback for unresolved cases. Intent is known noisy on shared-IP accounts (agencies, MSPs, large coworking ISPs) — needs a denylist seeded from the first 30 days of fires. JWT signing requires keeping the private key in Vercel env / a secret manager and rotating per ZI's recommended cadence.

## Install-time discovery
- **SKU bundle the customer pays for:** Does the customer's ZI contract include the Intent SKU? If yes, Streaming tier (daily) or weekly batch only? Streaming changes signal latency from ~7d to ~24h and is the difference between "catch the eval" and "miss the eval." Same question for Scoops and WebSights — both are gated add-ons, not part of base Advanced+.
- **Intent topic allowlist:** Confirm which of ZI's ~14k topics map cleanly to the customer's category buying intent. The draft topic list needs a 30-day backtest against known closed-won deals to confirm signal-to-noise before going to production rules.
- **Denylist of shared-IP companies:** Agencies, MSPs, coworking spaces, large ISPs, and ZI's own corporate IP. Seed from the first 30 days of WebSights + Intent fires by flagging any `companyId` that triggers on >5 unrelated customer pipelines. Also denylist the workspace's own employees' home/VPN ranges.
- **WebSights coverage:** Historically thin below ~200 employees — quantify the hit rate against the customer's actual ICP segment before promising AE coverage on SMB deals.
