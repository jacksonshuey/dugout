# HubSpot — Signal Dictionary

**Category:** Marketing automation + secondary CRM
**Role in stack:** Owns marketing site forms, nurture, email, and lifecycle scoring; bi-directionally syncs MQLs into Salesforce. Sees buying-committee members on the website BEFORE they appear on the Salesforce opportunity — and sees champion disengagement (no opens, unsubscribe, score drop) earlier than Salesforce activity history does.
**Integration surface:**
- **CRM Objects API** — date-versioned paths (`/crm/objects/2026-03/contacts`, `/companies`, `/deals`) replacing the legacy `/crm/v3/` namespace. Search via `POST /crm/v3/objects/{type}/search` with `filterGroups` + `filters` (operators `EQ`, `GT`, `GTE`, `LT`, `LTE`, `BETWEEN`, `IN`, `HAS_PROPERTY`, `CONTAINS_TOKEN`). Batch read via `POST /crm/v3/objects/{type}/batch/read` (up to 100 IDs per call). Associations via `GET /crm/v4/associations/{from}/{to}/labels` and `GET /crm/v4/objects/{type}/{id}/associations/{toType}` (HubSpot Companies API, dev docs).
- **Webhooks v4 (journal model)** — apps subscribe by `objectTypeId` (`0-1` contacts, `0-2` companies, `0-3` deals) + `actions` array (`CREATE`, `UPDATE`, `DELETE`, `MERGE`, `RESTORE`, `ASSOCIATION_ADDED`, `ASSOCIATION_REMOVED`, plus `APP_LIFECYCLE_EVENT`). Per the v4 webhooks reference, v4 subscriptions do not carry a `targetUrl` — the app polls the journal and gets events keyed by `offset` with `propertyChanges` on UPDATE events. Legacy v3 push webhooks (`contact.propertyChange`, `form.submission`, etc.) still ship payloads to a registered URL with `X-HubSpot-Signature-v3` (HMAC-SHA256 of `method + URI + body + timestamp`, validated against the 5-minute `X-HubSpot-Request-Timestamp` window). **Adapter uses v3 push for low-latency triggers (form.submission, contact.propertyChange on lifecyclestage) and v4 journal polling for backfill + replay**.
- **Forms API** — `formType` discriminates `hubspot` (native embed), `captured` (scraped from external pages), `flow` (popups), `blog_comment` (HubSpot Forms API guide). Each form has a stable `formGuid`; submissions deliver `pageUri`, `pageName`, `contactId`, and `conversionId` either via webhook subscription or `GET /marketing/v3/forms/{formGuid}/submissions`.
- **Email Events API** — `GET /email/public/v1/events` returns `OPEN`, `CLICK`, `SENT`, `DELIVERED`, `BOUNCE`, `DEFERRED`, `DROPPED`, `SPAMREPORT`, `UNSUBSCRIBE`, filterable by `recipient`, `eventType`, `startTimestamp`, `endTimestamp`.
- **Auth** — OAuth 2.0 required for multi-portal distribution; a **Private App** (static access token, not the deprecated hapikey) is the right choice for a single-portal adapter (HubSpot Intro to Auth). Required scopes: `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`, `crm.schemas.contacts.read`, `forms`, `content`, `sales-email-read`, `webhooks`.

**Pricing/access reality:** Marketing Hub Pro+ for workflow + HubSpot Score + custom lifecycle stages. Search API is throttled separately from the core read limit (historically 4 req/s per token, 200 results per page, 10k max via pagination — install-time confirm against current usage). Webhook subscriptions require a Developer Account + installed app on the customer portal.

## What it emits
Form fills, page views (CMS Hub + tracking script), email opens/clicks, workflow enrollments, lifecycle stage transitions, list memberships, HubSpot Score changes, and association events — all attributable to a contact email plus the anonymous `utk` cookie that gets stitched on first identification. v3 push webhooks fire within seconds; v4 journal events surface within ~1 minute of the underlying property change. CRM Object reads via API are strongly consistent.

## Signals we'd extract

### 1. Buying-committee shadow research — BLOCKING
- **What it is:** A NEW contact submits a form (especially `/security`, `/pricing`, `/legal/dpa`, `/implementation`, `/integrations/salesforce`) whose `email` domain matches a Company on an open Opportunity in Selected Vendor stage, AND that contact is NOT on any OpportunityContactRole.
- **Why for the wedge:** Finance, IT, Legal, or Procurement self-identifying on the website is the earliest possible signal that the deal has left the champion's hands. If the AE doesn't know they exist, they can't pre-empt their objections.
- **Rule shape:** v3 push webhook on `form.submission` for the curated set of `formGuid`s (security questionnaire, DPA request, pricing calculator, IT review) → hydrate via `POST /crm/v3/objects/contacts/batch/read` requesting `email,jobtitle,company,hs_analytics_source,hs_latest_source` → resolve email domain → join to Salesforce Account where StageName ∈ {Selected Vendor, Proposal} → check OCR membership → if absent → BLOCKING.
- **Source fields:** `formGuid`, `pageUri`, `pageName`, `contactId`, contact `email`, `jobtitle`, `hs_analytics_source`, Company association via `/crm/v4/objects/contacts/{id}/associations/companies`.
- **Citation:** HubSpot Forms API (formType + submission payload), Webhooks v3 push reference (signature scheme).

### 2. Dormant-deal re-engagement spike — ACTION
- **What it is:** Sum of email clicks + tracked page views from any contact at an Account with an open Opportunity that has had no Salesforce activity in 14+ days crosses a threshold (3 clicks OR 2 high-intent page views in 72h, where high-intent = pricing/security/integrations/case-study URL).
- **Why for the wedge:** A "dead" deal where the buyer is silently re-engaging marketing content means procurement or finance is doing diligence the rep can't see. Reopen the conversation before a competitor does.
- **Rule shape:** Cron (every 15 min) → `POST /crm/v3/objects/contacts/search` with `filterGroups`:
  - `hs_email_last_click_date GTE now-72h` OR `hs_analytics_last_timestamp GTE now-72h`
  - `associatedcompanyid HAS_PROPERTY true`
  - `properties: [hs_email_last_click_date, hs_analytics_last_url, num_unique_visits_recent, hs_last_sales_activity_timestamp, associatedcompanyid]`
  - cross-reference Salesforce `Opportunity.LastActivityDate < now-14d` for the joined Account → ACTION.
- **Source fields:** `hs_email_last_click_date`, `hs_email_last_open_date` (use sparingly — Apple MPP), `hs_analytics_last_url`, `hs_analytics_last_timestamp`, `num_unique_visits_recent`, `hs_last_sales_activity_timestamp`.
- **Citation:** CRM Search API (filterGroups/operators), Email Events API event types.

### 3. Lifecycle regression on active opp — ACTION
- **What it is:** A contact associated with an open Opportunity transitions backward in `lifecyclestage` (e.g., `salesqualifiedlead` → `marketingqualifiedlead`, `opportunity` → `lead`), typically because the lifecycle automation rule was manually overridden — HubSpot's default automation **only moves forward**, so a regression is a deliberate human or workflow signal.
- **Why for the wedge:** Champion going cold is often visible in HubSpot (sales rep manually downgrading, or "fell out of MQL list" workflow firing) before it shows in Salesforce. Pairs with "no recent meeting" to flag champion loss pre-Selected-Vendor.
- **Rule shape:** v3 push webhook on `contact.propertyChange` filtered to `propertyName=lifecyclestage` → compare `propertyValue` vs `previousValue` against canonical ordinal (`subscriber=1, lead=2, marketingqualifiedlead=3, salesqualifiedlead=4, opportunity=5, customer=6, evangelist=7, other=0`) → if new < old AND contact is on an open OCR → ACTION. Also subscribe to `propertyName=hs_lead_status` for downgrades to `BAD_TIMING` / `UNQUALIFIED`.
- **Source fields:** `propertyName`, `propertyValue`, `changeSource` (distinguish `WORKFLOWS` vs `CRM_UI` vs `INTEGRATION` — Salesforce sync regressions are noise, manual rep downgrades are the signal), contact→deal association via `/crm/v4`.
- **Citation:** HubSpot Lifecycle Stages knowledge base (forward-only auto-progression, eight default stages), Webhooks v3 propertyChange payload.

### 4. Competitor-content engagement — AWARENESS
- **What it is:** Contact at an active-opp account views CMS pages tagged as competitor-comparison (`/vs/<competitor>`, `/alternatives/*`) or downloads a competitor-switching guide.
- **Why for the wedge:** Late-funnel buyers shopping alternatives is a soft churn-of-deal signal. Worth the weekly digest, not worth waking the rep.
- **Rule shape:** Search contacts on `hs_analytics_last_url CONTAINS_TOKEN "/vs/"` OR list membership in a HubSpot Active List filtered on competitor URL pattern → AWARENESS. If Webflow owns these pages instead of HubSpot CMS, fall back to the Webflow adapter (page view events absent from HubSpot).
- **Source fields:** `hs_analytics_last_url`, `hs_analytics_source`, `hs_analytics_source_data_1`.

## What we'd ignore
- **Email opens** as a primary trigger — Apple MPP pre-fetches images on receipt and the `OPEN` event fires for every Mail.app recipient regardless of engagement. Useful only as a *negative* signal (zero opens in 30d on a previously engaged contact).
- Social media follows/mentions tracked in HubSpot Social.
- Top-of-funnel blog views by anonymous visitors not yet stitched to a contact (`utk` cookie without email).
- **HubSpot Score absolute values** — score model drifts; only score deltas (>+15 in 7d) matter.
- Nurture email auto-clicks from security scanners (Mimecast, Proofpoint, Barracuda link-protection pre-fetch — User-Agent and IP-based filtering required).
- Form fills from existing OCR members on the active opp — Salesforce already knows.
- Webhook events with `changeSource=INTEGRATION` where the integration is Salesforce (echoes of our own sync).

## Effort to wire
- **Adapter LOC estimate:** ~400 LOC TypeScript — webhook receiver with `X-HubSpot-Signature-v3` verification (HMAC-SHA256 of `method + uri + body + timestamp`, reject if timestamp > 5 min old), v4 journal poller for replay/backfill, contact + company batch-read hydration, Salesforce join helper, lifecycle ordinal diff.
- **Time estimate:** 1.5 days for signals 1–3; +0.5 day for competitor URL taxonomy + bot filtering rules.
- **Hardest part:** Reliable email→Account resolution when contacts use personal Gmail addresses (common for procurement/legal/IT consultants). Needs ZoomInfo enrichment fallback plus a heuristic on HubSpot Company `domain` association (the canonical company dedup key per the Companies API).
- **Rate-limit footprint:** Webhook-driven signals (1, 3) cost zero polling. Signal 2 is one search query every 15 min (~96/day) — well under the search API ceiling. Hydration batch-reads cost 1 call per ~100 contacts.

## Install-time discovery
The adapter must learn these per-customer at onboarding (one-time config wizard backed by HubSpot API calls):

1. **HubSpot Company ↔ Salesforce Account sync topology.** Query a sample of 50 HubSpot Companies and check whether each has a populated Salesforce sync `hs_object_source_id` plus a matching SFDC AccountId. If <90% match, signal 1 needs the ZoomInfo domain-resolution fallback. (`/crm/v3/objects/companies/search`.)
2. **Form GUID inventory.** `GET /marketing/v3/forms` → present the operator a checklist filtered to forms whose `name` or `pageUri` matches `security|pricing|dpa|legal|implementation|integrations`. Persist the chosen `formGuid` set as the signal-1 trigger list.
3. **CMS host of high-intent pages.** Test-fetch `/security`, `/pricing`, `/legal/dpa` and inspect response headers (HubSpot CMS sets `x-hs-cache-config`; Webflow sets `x-wf-server`). Decides whether signal 1 + signal 4 sources are HubSpot or Webflow.
4. **Custom lifecycle stages.** `GET /crm/v3/properties/contacts/lifecyclestage` → enumerate `options[]`. The customer may have added stages between SQL and Opportunity (e.g., "Selected Vendor"); the ordinal map in signal 3 needs to include them.
5. **Lead-scoring property name + threshold.** `hubspotscore` is default, but Marketing Hub Enterprise customers often use a custom calculated property (e.g., `predictive_lead_score`). Pull `/crm/v3/properties/contacts` and prompt operator to confirm the active score property.
6. **Webhook subscription IDs.** Create v3 push subscriptions for `contact.propertyChange:lifecyclestage`, `contact.propertyChange:hs_lead_status`, `form.submission` (per chosen formGuid). Persist subscription IDs for teardown on uninstall.
7. **Active List IDs for competitor-content audience** (signal 4). Either reuse an existing HubSpot list or create one via `POST /contacts/v1/lists` filtered on competitor URL regex; persist the `listId`.
8. **MQL→SQL handoff SLA + ownership.** Not API-discoverable — surface as a one-question install survey to the RevOps admin: "When a contact on an open Opportunity gets created in HubSpot and reaches MQL, who is alerted within how many hours?" Answer calibrates signal 1's BLOCKING vs ACTION tier.
