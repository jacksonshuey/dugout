# Webflow — Signal Dictionary

**Category:** Website / CMS (with optional visitor-identity layer)
**Role in stack:** Hosts the workspace's marketing site — pages, blog, lead-capture forms, pricing, security/trust pages.
**Integration surface:** Data REST API v2 (`https://api.webflow.com/v2/...`), webhooks (subscribed via `POST /v2/sites/{site_id}/webhooks`), OAuth 2.0 or Site API tokens with scoped permissions (`forms:read`, `cms:read`, `sites:read`).
**Pricing/access reality:** Webhooks are free on all Site Plans; Data API is included. Webhook subscription cap of 25 per site. Form submissions are retained on Webflow for export, but the webhook is the durable real-time path.

## Honest framing — read this first

Webflow standalone is a CMS. It serves pages, stores CMS collections, and accepts form submissions. **It does not know who visits, what account they belong to, what pages they viewed, or where they are in a deal cycle.** The only first-party "buyer-touched-us" signal Webflow emits natively is `form_submission`. Everything else (page views, account identity, intent) requires a layered visitor-identity tool — Clearbit Reveal, RB2B, Warmly, or the HubSpot tracking script — running on top of the Webflow site.

For the Selected-Vendor-stall wedge: Webflow's standalone signal value is narrow but real (high-intent form submissions from open-opp domains). The expansive "anonymous account visit to /security from a buying committee member" signal lives in the de-anon tool's event stream, not Webflow's API. Don't oversell the standalone surface; don't ignore the layered one.

## What Webflow emits natively

### Webhook events (subscribed via `POST /v2/sites/{site_id}/webhooks`)
Exact `triggerType` strings:
- `form_submission` — the only buyer-intent event
- `site_publish` — marketing ops noise unless tied to landing-page deploys
- `collection_item_created`, `collection_item_changed`, `collection_item_deleted`, `collection_item_unpublished` — CMS edits, internal noise
- `page_created`, `page_metadata_updated`, `page_deleted` — page lifecycle, noise
- `ecomm_new_order`, `ecomm_order_changed`, `ecomm_inventory_changed` — N/A (the workspace isn't ecomm)
- `user_account_added`, `user_account_updated`, `user_account_deleted` — Memberships, N/A

### Form submission API
- `GET /v2/forms/{form_id}/submissions` — list submissions for a form
- `GET /v2/sites/{site_id}/forms` — list forms on a site (with `displayName`, `id`)
- Submission payload key fields: `id`, `displayName` (form name), `formId`, `siteId`, `formResponse` (key→value map of submitted fields, including the email field as configured), `dateSubmitted`

### `form_submission` webhook payload (top-level shape)
```
{
  "triggerType": "form_submission",
  "payload": {
    "name": "<form display name>",
    "siteId": "...",
    "data": { "<field-name>": "<value>", ... },
    "submittedAt": "<ISO timestamp>",
    "id": "<submission id>",
    "formId": "..."
  }
}
```
The `data` object's keys come from the field labels/names configured in the Webflow Designer — install-time discovery item below.

## Signals — standalone (Webflow only)

### 1. High-intent form submission from open-deal account — ACTION
- **What it is:** A `form_submission` from a high-intent form (Request Demo, Contact Sales, Pricing Inquiry, Talk to Sales) where the submitted work email's domain matches an account with an open Salesforce opportunity in Discovery or later.
- **Why for the wedge:** A champion or peer re-engaging the site mid-cycle is buying-committee expansion — the exact motion that dies silently between champion buy-in and procurement.
- **Rule shape:** `triggerType == 'form_submission' AND payload.name IN [high_intent_forms] AND emailDomain(payload.data.email) IN sfdc.open_opps.account_domains AND payload.data.email NOT IN opp.known_contacts`
- **Source fields:** `payload.name`, `payload.data.email`, `payload.data.company`, `payload.siteId`, `payload.submittedAt`

### 2. Pricing-page form submission from net-new contact at named account — ACTION
- **What it is:** Pricing inquiry where domain matches a target/open-opp account but the submitter is not on the opportunity contact roster.
- **Why for the wedge:** New buying-committee member surfacing themselves — disproportionately Finance, IT, or Procurement, the exact personas that block at Selected Vendor.
- **Rule shape:** `payload.name = 'pricing' AND emailDomain(payload.data.email) IN target_accounts AND payload.data.email NOT IN opp.contacts`
- **Source fields:** same as above

### 3. Personal-email submission from open-opp domain pattern — AWARENESS
- **What it is:** A high-intent form submission from a personal email (gmail/outlook) where other payload fields (company name, free-text "where do you work") match an open-opp account.
- **Why for the wedge:** Buying committee members sometimes research from personal accounts at night — weak but worth a notify if the company-name match is high-confidence.
- **Source fields:** `payload.data.company`, `payload.data.email`, free-text comment fields

## Signals — only if visitor identity is layered on

These require Clearbit Reveal, RB2B, Warmly, or HubSpot tracking script on the Webflow site. Webflow itself does not emit any of this; the layered tool does, and Webflow is just the surface that hosts the script.

### Clearbit Reveal (reverse-IP, account-level)
- **What it provides:** Account identification from anonymous traffic via IP-to-company resolution. Returns firmographics (company name, domain, industry, NAICS/GICS/SIC, employee count, revenue, HQ location).
- **Granularity:** Account-level only (no person). US + global.
- **Signal it enables:** "Identified account in open-opp list visited /pricing or /security N times in last 7d" — late-stage research behavior.

### RB2B (person-level, US-only)
- **What it provides:** Person-level identification of US B2B visitors via cookie/identity-graph resolution. Returns name, LinkedIn URL, business email, employer. Demandbase partnership for global account-level. Claims 70–80% combined identification rate.
- **Granularity:** Person + account (US person-level only — GDPR/CCPA blocks EU person-level).
- **Signal it enables:** "Net-new named individual at open-opp account just hit /security" — the highest-signal version of buying-committee expansion.
- **Native delivery:** Real-time Slack/Teams pings, CRM push, "Hot Pages" intent tracking.

### Warmly (de-anon + autonomous engagement)
- **What it provides:** Account- and person-level de-anonymization, Context Graph blending 1st/2nd/3rd-party intent (web behavior, job changes, keyword research, competitor research). Bundles auto-engagement (chatbot, personalized landing pages, retargeting, LinkedIn/email orchestration).
- **Granularity:** Account + person, with built-in routing/notify.
- **Signal it enables:** Same as Reveal+RB2B, plus job-change/new-hire triggers on buying-committee accounts.
- **Tradeoff vs Dugout:** Warmly already does the "notify on intent" job partially — overlap to manage at install time.

### Layered signal: anonymous account visit spike on high-intent pages — AWARENESS
- **What it is:** Identified-account visit count to `/pricing`, `/security`, `/integrations`, or `/trust` exceeds baseline.
- **Why for the wedge:** Late-stage Finance/IT research consistently routes through pricing and security before procurement engages.
- **Rule shape:** `deanon.account_visits(page IN [pricing, security, integrations]) > 3 within 7d AND account IN open_opps`
- **Source:** the de-anon tool's webhook / API, not Webflow's

### Layered signal: net-new buying-committee individual on security page — ACTION (RB2B/Warmly only)
- **What it is:** Person-level identification of a previously-unknown contact at an open-opp account hitting `/security` or `/pricing`.
- **Rule shape:** `deanon.person.email NOT IN opp.contacts AND deanon.account IN open_opps AND page IN [security, pricing]`
- **Why for the wedge:** This is the cleanest "new blocker just appeared" signal in the entire stack — Finance or IT seniority + late-stage page = procurement is about to engage or kill.

## What we'd ignore
- `site_publish` events
- All `collection_item_*` events
- All `page_*` events
- `form_submission` from newsletter / gated-content / blog-comment forms
- Aggregate page views without account identity
- Form submissions from disposable/throwaway email domains with no firmographic match

## Effort to wire (standalone Webflow adapter)
- **Adapter LOC estimate:** ~120 LOC (webhook receiver, signature verification, domain-to-SFDC-account join, form-name allowlist)
- **Time estimate:** 2–3 hours
- **Hardest part:** Email-domain → Salesforce account matching with reasonable precision (same join problem every Dugout adapter has).
- **Layered adapter (if Reveal/RB2B/Warmly present):** add ~150 LOC for the de-anon tool's webhook + page-intent filter. Each de-anon tool has a distinct payload — pick one.

## Install-time discovery
1. **Which de-anon tool (if any) is running on the marketing site?** Check `<head>` for Clearbit Reveal script, RB2B pixel (`b2bjsstore.s3...`), Warmly tag, or HubSpot tracking. This determines whether the layered signals are real or aspirational, and which adapter to write second.
2. **High-intent form taxonomy.** Pull `GET /v2/sites/{site_id}/forms` and have RevOps tag which `displayName` values are high-intent (demo/sales/pricing) vs newsletter/gated-content. Without this taxonomy the form_submission firehose is too noisy.
3. **HubSpot tracking-script overlap.** If HubSpot's tracking script is the de-facto identity layer on the marketing site, the Webflow form_submission webhook is largely duplicative of the HubSpot "form submission" event — decide which is canonical to avoid double-firing in Dugout. Default: HubSpot canonical for forms it tracks, Webflow webhook as fallback/backup ingest.
