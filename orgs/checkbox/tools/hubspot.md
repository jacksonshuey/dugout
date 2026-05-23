# HubSpot — Signal Dictionary

**Category:** Marketing automation
**Role in stack:** Owns marketing site, forms, nurture, and email — feeds MQLs into Salesforce via bi-directional sync; the system that sees buying-committee members BEFORE they appear on the Salesforce opportunity.
**Integration surface:** REST API v3 (CRM Objects, Engagements, Forms), CRM Webhooks v3 (contact.creation, contact.propertyChange, form.submission, email.click), OAuth 2.0 app (preferred over deprecated API keys).
**Pricing/access reality:** Marketing Hub Pro+ for workflow/scoring data; private OAuth app on the Checkbox HubSpot portal; webhook subscriptions require Developer Account + app install. Form submission webhooks need `forms` scope; engagement events need `sales-email-read` + `content` scopes.

## What it emits
Form fills, page views (CMS Hub tracking), email opens/clicks, workflow enrollments, lifecycle stage transitions, list memberships, and HubSpot Score changes — all attributable to a contact email, plus anonymous `utk` cookies that get stitched on identification. Webhooks fire near-real-time (typically <60s); object reads via API are immediate.

## Signals we'd extract

### 1. Buying-committee shadow research — BLOCKING
- **What it is:** A NEW contact submits a form (especially `/security`, `/pricing`, `/legal/dpa`, `/implementation`) where `contact.email` domain matches a Company on an open Opportunity in Selected Vendor stage, AND that contact is NOT on any OpportunityContactRole.
- **Why for the wedge:** Finance/IT/Legal/Procurement self-identifying on the website is the earliest possible signal that the deal has left the champion's hands. If the AE doesn't know they exist, they can't pre-empt their objections.
- **Rule shape:** Webhook `form.submission` → resolve contact email domain → join to Salesforce Account where stage ∈ {Selected Vendor, Proposal} → check OCR membership → if absent AND form is in security/pricing/legal/IT set → BLOCKING.
- **Source fields:** `subscriptionType=form.submission`, `contact.properties.email`, `contact.properties.jobtitle`, `formGuid`, `pageUri`, `companies` association.

### 2. Dormant-deal re-engagement spike — ACTION
- **What it is:** Sum of email clicks + tracked page views from any contact at an Account with an open Opportunity that has had no Salesforce activity in 14+ days crosses a threshold (e.g., 3 clicks or 2 high-intent page views in 72h).
- **Why for the wedge:** A "dead" deal where the buyer is silently re-engaging marketing content means procurement or finance is doing diligence the rep can't see. Reopen the conversation before a competitor does.
- **Rule shape:** Cron job querying `/crm/v3/objects/contacts/search` filtered by `hs_last_sales_activity_timestamp` + `hs_email_last_click_date` within 72h, cross-referenced against Salesforce Opportunity.LastActivityDate.
- **Source fields:** `hs_email_last_click_date`, `hs_analytics_last_url`, `num_unique_visits_recent`, Account→Opportunity join.

### 3. Lifecycle regression on active opp — ACTION
- **What it is:** A contact associated with an open Opportunity transitions backward in `lifecyclestage` (e.g., SQL → MQL, or Opportunity → Lead) via a HubSpot workflow, typically because they unsubscribed, bounced, or fell out of a scoring threshold.
- **Why for the wedge:** Champion going cold is often visible in HubSpot (unsubscribe, no opens for 30d) before it shows in Salesforce. Pairs with "no recent meeting" to flag champion loss pre-Selected-Vendor.
- **Rule shape:** Webhook `contact.propertyChange` on `lifecyclestage` → compare old vs new ordinal → if regressed AND contact is on an open OCR → ACTION.
- **Source fields:** `propertyName=lifecyclestage`, `propertyValue`, `previousValue`, contact→deal association.

### 4. Competitor-content engagement — AWARENESS
- **What it is:** Contact at an active-opp account views CMS pages tagged as competitor-comparison (`/vs/ironclad`, `/vs/linksquares`) or downloads a competitor-switching guide.
- **Why for the wedge:** Late-funnel buyers shopping alternatives is a soft churn-of-deal signal. Worth surfacing in the weekly digest, not worth waking the rep up.
- **Rule shape:** Page view event where `pageUri` matches competitor regex → AWARENESS.
- **Source fields:** `hs_analytics_last_url`, `hs_analytics_source`.

## What we'd ignore
- Email opens (pixel-based, noisy, Apple MPP makes them meaningless).
- Social media follows/mentions tracked in HubSpot Social.
- Top-of-funnel blog views by anonymous visitors not yet stitched to a contact.
- HubSpot Score absolute values (model drift); only score deltas matter.
- Nurture email auto-clicks from security scanners (Mimecast, Proofpoint pre-fetch).
- Form fills from existing OCR members on the active opp — Salesforce already knows.

## Effort to wire
- **Adapter LOC estimate:** ~350 LOC TypeScript (webhook receiver + signature verification, contact/company hydration via batch read, Salesforce join helper).
- **Time estimate:** 1.5 days for signals 1–3; +0.5 day for competitor URL taxonomy.
- **Hardest part:** Reliable email→Account resolution when contacts use personal Gmail addresses (common for procurement/legal) — needs ZoomInfo fallback or company-association heuristic on the HubSpot Company object.

## Open questions
1. Does Checkbox sync HubSpot Company ↔ Salesforce Account 1:1, or are there orphan HubSpot Companies? Affects join reliability.
2. Are the `/security` and `/legal/dpa` pages actually on HubSpot CMS, or on Webflow? If Webflow, signal 1 needs a different source.
3. What's the current MQL→SQL handoff SLA — and does anyone own the "MQL on an open opp" edge case today?
