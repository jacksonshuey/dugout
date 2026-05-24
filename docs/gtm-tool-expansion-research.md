# Dugout GTM Tool Expansion Research

Last updated: 2026-05-22. Author context: GTM-engineer-interview prep for Checkbox. Scope: which net-new integrations should Dugout build real adapters for, ranked by signal value to the deal-death-detection wedge.

## TL;DR

Dugout already covers the "saw it in a meeting / saw it in the news" surface area well. The real signal gaps are (1) **buyer-intent and stakeholder-discovery data** (G2, Bombora, LinkedIn Sales Navigator, Common Room) that tells us *who else inside the account is researching*, (2) **revenue/CRM activity** (real Salesforce + Gong APIs, not config stubs) that tells us *which stakeholder has gone quiet*, and (3) **contract/procurement signals** (Ironclad, Vendr, Tropic) that map directly to Checkbox's Finance/IT/Legal wedge. Of everything below, the three must-haves are **G2 Buyer Intent**, **Common Room**, and **LinkedIn Sales Navigator** — because they're the only categories that surface stakeholder-engagement gaps *before* the deal stalls, which is the load-bearing job.

## Categories we're missing

### 1. Third-party buyer intent / review-site signals

These are the single largest gap. They tell us a procurement committee is forming on the buyer side — often before the AE knows.

- **G2 Buyer Intent** — g2.com. Surfaces accounts researching your category/competitors on G2. Public REST API on the **Buyer Intent Activity** endpoint. Auth: OAuth2 client credentials. Pricing: requires G2 Power or Buyer Intent add-on (~$30k+/yr); no free tier. Relevance: **High** — direct "buyer is procuring" signal.
- **TrustRadius Intent** — trustradius.com. Similar to G2 but lower volume; better in enterprise infrastructure categories than legal-tech. REST API. OAuth2. Enterprise contract only. Relevance: **Medium**.
- **Capterra / GetApp (Gartner Digital Markets)** — capterra.com. Lead-form data, no real intent stream. No usable public API for intent. Relevance: **Low** (skip).

### 2. Aggregated B2B intent data

Stitched-together publisher network intent — broader than review sites, more noise.

- **Bombora Company Surge** — bombora.com. Co-op intent data across ~5k publishers. REST API (Company Surge). API key + account ID. Pricing: ~$25k/yr floor, no self-serve. Relevance: **High** for top-of-funnel, **Medium** for late-stage deal-death detection.
- **6sense** — 6sense.com. Account-level intent + predictive scoring. REST API with account-level data export. OAuth2. Enterprise contract only (~$60k+). Relevance: **High** but cost-prohibitive for a demo.
- **Demandbase** — demandbase.com. Similar to 6sense, slightly weaker API surface. Enterprise only. Relevance: **Medium**.

### 3. Community / dark-funnel signals

This is the under-covered surface area where buying committees actually form (Slack communities, subreddits, podcasts, GitHub).

- **Common Room** — commonroom.io. Identifies champion + buying-committee signals across Slack/Discord/LinkedIn/GitHub. **Public REST API** with webhooks. API key auth. Free tier exists; paid starts ~$1k/mo. Relevance: **High** — uniquely good at "new stakeholder appeared in the account."
- **Champify** — champify.io. Tracks job changes of past champions/users into new accounts. REST API. API key. ~$1k/mo. Relevance: **High** for warm-account creation; less for late-stage deal-death.
- **UserGems** — usergems.com. Same job-change-tracking thesis as Champify. REST API + webhooks. OAuth2. ~$1.5k/mo floor. Relevance: **High**.

### 4. Revenue intelligence / conversation intelligence (real APIs)

We already show Gong/Chorus as logos, but the actual Gong API is excellent and we should treat it as a tier-1 integration.

- **Gong** — gong.io. Call transcripts, deal warnings, sentiment, stakeholder coverage. **Public REST API** (very well documented). OAuth2 + API key. Included with any paid Gong seat. Relevance: **High** — stakeholder coverage gaps are literally a native Gong concept.
- **Chorus (ZoomInfo)** — chorus.ai. Similar coverage, weaker API ergonomics post-ZoomInfo acquisition. OAuth2. Included with paid Chorus. Relevance: **Medium**.
- **Clari** — clari.com. Forecast + deal-momentum signals. REST API for opportunity scoring. OAuth2. Enterprise contract. Relevance: **High** — Clari's "deal at risk" flag is the same shape as Dugout's output.

### 5. CRM (real adapters, not config stubs)

Listed as workspace config today; the live integration is the difference between "logo" and "product."

- **Salesforce** — salesforce.com. Industry-standard CRM. REST + Bulk + Streaming APIs. OAuth2 + JWT bearer flow. Free Developer Edition gives full API access. Relevance: **High** — required for any "stage = Selected Vendor" detection.
- **HubSpot** — hubspot.com. CRM + marketing. REST API, webhooks. OAuth2 or private app token. Free CRM tier includes API. Relevance: **High** for SMB ICP.
- **Attio** — attio.com. Modern relational CRM. Clean REST API + webhooks. OAuth2 or API key. Free tier includes API. Relevance: **Medium** (small but growing share).

### 6. Contract lifecycle management / procurement (most relevant to the wedge)

This is Checkbox's adjacent space — and the most under-instrumented stage of the deal.

- **Ironclad** — ironcladapp.com. CLM, workflow status (e.g., "stuck in legal review for 14 days"). REST API. OAuth2. Business tier and up (~$15k/yr). Relevance: **High** — legal stall is the exact wedge.
- **DocuSign CLM** — docusign.com. Already listed as e-sign logo, but the **CLM API** is separate and more valuable. REST API. OAuth2. Enterprise contract. Relevance: **High**.
- **Vendr** — vendr.com. Buyer-side procurement broker; surfaces vendor-evaluation signals (competitor benchmarks, pricing). Limited public API, mostly partner-only. Relevance: **High** if accessible, **N/A** if not.
- **Tropic** — tropic.com. SaaS procurement platform. Partner API only, no self-serve. Relevance: **Medium**.

### 7. Customer success / product usage (renewal + expansion deal-death)

Useful if Dugout expands beyond new-business deals.

- **Pendo** — pendo.io. Product analytics + NPS. REST API. API key. Free tier exists. Relevance: **Medium** (expansion-deal wedge, not net-new).
- **Gainsight** — gainsight.com. CS platform. REST API. OAuth2. Enterprise contract. Relevance: **Medium**.
- **Catalyst / Vitally / ChurnZero** — similar shape. Mostly enterprise-priced APIs. Relevance: **Low** for new-business deals.

### 8. Hiring / people signals

Job postings = budget signals; new hires = new stakeholders.

- **LinkedIn Sales Navigator** — linkedin.com/sales. Account changes, new hires, role changes, intent. **No general public API**; the Sales Navigator API is partner-gated. Workaround: scraping (ToS violation, skip) or Phantombuster/Bright Data (legal grey zone). Relevance: **High** but **dealbreaker on API access**.
- **Apollo.io** — apollo.io. Has the LinkedIn-data shape via their own graph + public REST API. API key. Free tier with rate limits, paid starts ~$50/mo. Relevance: **High** — best practical substitute for raw LinkedIn data.
- **Crunchbase** — crunchbase.com. Funding + hiring + exec changes. REST API. API key. Pro tier required for API (~$500/mo). Relevance: **High** — funding rounds = budget cycle.
- **The Org** — theorg.com. Org-chart data. REST API in beta, partner-gated. Relevance: **Medium**.

### 9. Technographics

What software the account already uses — useful for competitive displacement and integration-fit signals.

- **BuiltWith** — builtwith.com. Web-stack detection. REST API. API key. Pro tier ~$295/mo for API. Relevance: **Medium**.
- **HG Insights** — hginsights.com. Enterprise technographics. Partner API only. Relevance: **Low** (access barrier).
- **Wappalyzer** — wappalyzer.com. Cheap technographic API. API key. ~$50/mo. Relevance: **Medium**.

### 10. Financial / public-company data (beyond SEC EDGAR)

We have EDGAR for 8-Ks. There's more to grab.

- **Financial Modeling Prep** — financialmodelingprep.com. Fundamentals, earnings transcripts. REST API. API key. Free tier (250 req/day), paid ~$30/mo. Relevance: **Medium** — earnings-call mentions of "legal review" or "compliance" are a real signal.
- **AlphaSense** — alpha-sense.com. Search across earnings + expert calls. Enterprise contract only. Relevance: **High** but **dealbreaker** on cost/access.
- **Quartr** — quartr.com. Earnings transcript API. REST. API key. Reasonable pricing. Relevance: **Medium**.

### 11. Social listening / brand monitoring

Mostly weak signal for B2B deal intel, but worth scoping.

- **Brandwatch / Sprinklr / Meltwater** — all enterprise-contract, no self-serve API. **Skip.**
- **Reddit API** — reddit.com/dev/api. Free, OAuth2. Relevance: **Low-Medium** (decent for legal-tech community sentiment via r/legaltech, r/Lawyertalk).
- **Hacker News (Algolia)** — hn.algolia.com. Free REST API, no auth. Relevance: **Low** for legal-tech specifically.

### 12. Calendar / meeting data (beyond Granola)

- **Google Calendar API** — REST, OAuth2, free. Relevance: **High** — "next meeting with this account is X days away" is a load-bearing Dugout signal.
- **Microsoft Graph (Outlook Calendar)** — REST, OAuth2, free with M365. Relevance: **High** (essential for enterprise ICP).

### 13. Email / engagement (beyond newsletter inbox)

- **Gmail API** — REST, OAuth2, free. Relevance: **High** — "champion hasn't replied in 7 days" detection.
- **Microsoft Graph (Outlook Mail)** — Same shape as Calendar above. Relevance: **High**.

### 14. Ticketing / support signals

If support tickets spike from an account in eval, that's a deal-risk signal.

- **Zendesk** — zendesk.com. REST API. OAuth2 or API token. Included in paid plans. Relevance: **Medium**.
- **Intercom** — intercom.com. REST API. OAuth2. Included in paid plans. Relevance: **Medium**.
- **Linear** — linear.app. GraphQL API. API key. Free tier. Relevance: **Low** (internal tool, not buyer-facing).

## Top 15 prioritized recommendations

Ranked by signal-quality × API-accessibility × wedge-relevance.

1. **Salesforce (real API)** — Without this, every other CRM-dependent signal is a stub. Free Dev Edition, mature REST + Streaming APIs, OAuth2. This is the spine. Build first.
2. **Gong (real API)** — Excellent REST API, included with any paid Gong seat. Stakeholder-coverage gaps are a native Gong primitive — almost zero translation cost to Dugout's signal model.
3. **HubSpot (real API)** — Free tier with full API, OAuth2 or private app token. Covers the SMB half of the ICP that Salesforce doesn't. Cheap to build, cheap to demo.
4. **Common Room** — Cleanest API for "new committee member appeared." Free tier exists. OAuth + API key. The job-change + community-signal data here is the closest thing to a unique unlock for the stakeholder-engagement wedge.
5. **G2 Buyer Intent** — Tier-one signal: "account is on a comparison page for your category right now." Cost is the only friction (~$30k/yr) but the demo value is huge — would justify a "mocked-data" demo path even without paid access.
6. **Google Calendar + Gmail APIs** — Free, OAuth2, free tier. "Champion went silent for 7 days" / "next touch is 11 days out" are textbook deal-death signals and trivially API-accessible.
7. **Apollo.io** — Practical LinkedIn substitute. Public REST API, $50/mo paid tier, decent rate limits. Use for net-new stakeholder discovery and exec-change tracking.
8. **Microsoft Graph (Outlook Calendar + Mail)** — Same shape as Google but for enterprise ICP. OAuth2, free with M365. Pair-build with Google.
9. **Ironclad** — Legal-CLM workflow status is *exactly* the Checkbox wedge ("stuck in legal review for 14 days" = deal-death). REST API, OAuth2. Pricing tier is high but interview-relevance is unmatched.
10. **Crunchbase** — Funding-round = budget-cycle is a clean macro signal. ~$500/mo Pro tier, REST API, API key. Worth it for the "Series C closed yesterday, push the deal" play.
11. **Clari** — Native "deal at risk" forecast signal. REST API, OAuth2, enterprise only — but the signal shape maps 1:1 to Dugout output, so worth a partner-pitch even if not buildable now.
12. **Bombora Company Surge** — Wide-net intent data across publishers. Cost-prohibitive direct, but often resold via Salesloft/Outreach — could be backdoored cheaper.
13. **UserGems or Champify (pick one)** — Champion job-change tracking. ~$1-1.5k/mo. REST API + webhooks. The "your buyer moved to NewCo, push them again" play.
14. **BuiltWith** — Technographic detection of competitive software in-use at the account. REST API, $295/mo. Medium signal but cheap and clean.
15. **DocuSign CLM API** (distinct from e-sign) — Workflow-stage data on contracts already in flight. OAuth2, enterprise. Wedge-relevant; build after Ironclad if Ironclad doesn't land.

## Must-haves

Three integrations that unlock signal categories Dugout currently cannot produce at all.

1. **G2 Buyer Intent** — Right now Dugout has no "the buyer is actively shopping" signal. Every other input is reactive (news happened, meeting happened, email arrived). G2 intent is the only proactive "procurement committee is forming" signal. Even if direct API access is cost-prohibitive, a stubbed/mocked G2 feed for the demo is high-leverage because it shows you understand where the wedge widens.
2. **Common Room** — Currently no way to detect a *new* stakeholder appearing on the buyer side (a Finance VP who just joined the Slack community, a new IT director who started commenting on GitHub). This is the single highest-fidelity input for the Finance/IT/Legal-engagement gap the wedge depends on. Free tier + clean REST API means there's no excuse not to build it.
3. **Gong real API** (not just the logo) — Conversation intelligence is the obvious source of truth for "we haven't talked to Legal yet" and Dugout currently treats it as a config-only stub. Gong's API is among the best in B2B SaaS. Building this turns the "Gong supported" claim from theater into product.

## Dealbreakers / categories to skip

- **LinkedIn (direct)** — Sales Navigator API is partner-gated and gatekept; scraping violates ToS. Don't build it directly. Substitute with Apollo, Common Room, UserGems for the same data shape.
- **6sense / Demandbase / AlphaSense / Brandwatch / HG Insights** — All enterprise-contract-only, no self-serve, $50k+/yr floor, partner-gated APIs. Great signal but not buildable inside a demo budget. Show as logos at most.
- **Vendr / Tropic** — Procurement-broker APIs are partner-only and the partner programs are slow and selective. Likely not buildable in interview-prep timeframe.
- **Capterra / GetApp / Gartner Digital Markets** — No usable intent API; the data is lead-form-only and locked to paid lead-gen contracts. Skip.
- **Brandwatch / Sprinklr / Meltwater / Cision** — Enterprise social-listening platforms; no self-serve, six-figure contracts. Substitute with Reddit + HN free APIs if you want any social signal at all (low ROI for legal-tech B2B specifically).
- **Gainsight / ChurnZero / Vitally** — CS platforms are renewal/expansion focused; not where the "Selected Vendor" deal-death wedge lives. Defer until Dugout expands beyond new-business deals.
- **HG Insights / The Org** — Partner-gated APIs, slow programs. Use BuiltWith / Apollo / Crunchbase as substitutes.

## Build-order recommendation (if forced to pick)

Sprint 1 (CRM spine + obvious wins): **Salesforce, HubSpot, Google Calendar + Gmail, Microsoft Graph**.
Sprint 2 (the wedge-relevant signal unlocks): **Gong real API, Common Room, Apollo, Crunchbase**.
Sprint 3 (the demo-defining moves): **G2 Buyer Intent (mocked if needed), Ironclad, UserGems/Champify**.
Anything beyond sprint 3 is gold-plating for an interview demo — pick based on which Checkbox interviewer-affinity story you want to tell.
