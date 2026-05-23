# Webflow — Signal Dictionary

**Category:** Website / CMS
**Role in stack:** Hosts Checkbox's marketing site, blog, and lead-capture forms.
**Integration surface:** CMS API (REST), Form submissions webhook (`form_submission`), Logic webhooks, site publish events.
**Pricing/access reality:** Site Plans include API access; webhooks are free. Form submissions webhook is the only first-party "buyer-touched-us" signal Webflow emits natively.

## Honest wedge alignment
Webflow alone is a CMS — it serves pages and collects form submissions. It does not know who visits, what account they belong to, or where they are in a deal cycle. Real sales-signal value at the marketing-site layer comes from visitor de-anonymization (Clearbit Reveal, RB2B, Warmly) or marketing pixels (HubSpot — covered in its own dictionary). Without those layered on, Webflow gives us form payloads and content metadata, not buyer intent.

## What it emits (standalone)
Form submission webhooks (form name, field payload, site ID, submitted-at), CMS collection item create/update/delete events, and site publish events. No visitor identity, no session data, no per-page analytics via API.

## Signals we'd extract (standalone, before any layered tools)

### 1. High-intent form submission from open deal account — ACTION
- **What it is:** A `form_submission` from "Request Demo," "Contact Sales," or "Pricing" form where the submitted work email domain matches an account with an open Salesforce opportunity in Discovery or later stage.
- **Why for the wedge:** A champion or peer re-engaging the site mid-cycle is a buying-committee expansion signal — exactly what dies silently between champion buy-in and procurement.
- **Rule shape:** `form.name IN [high_intent_forms] AND email.domain IN sfdc.open_opps.account_domains AND submitter.email NOT IN opp.known_contacts`
- **Source fields:** `payload.data.email`, `payload.data.company`, `payload.name`, `payload.siteId`, `submittedAt`

### 2. Pricing-page form submission from net-new contact at named account — ACTION
- **What it is:** Pricing inquiry where domain matches a target account but submitter is not on the opp contact roster.
- **Why for the wedge:** New buying-committee member surfacing themselves — often Finance or IT, the exact personas that block at Selected Vendor.
- **Rule shape:** `form.name = 'pricing' AND email.domain IN target_accounts AND email NOT IN opp.contacts`
- **Source fields:** same as above

## Signals we'd extract IF visitor de-anonymization is layered on
These require Clearbit Reveal, RB2B, or Warmly running on the Webflow site. Webflow itself does not emit these — the layered tool does, and Webflow is just the surface they instrument.

### A. Anonymous account visit spike on pricing/security pages — AWARENESS
- **What it is:** Identified-account visit count to `/pricing`, `/security`, or `/integrations` exceeds baseline.
- **Why for the wedge:** Late-stage research behavior from Finance/IT personas typically routes through pricing and security pages before procurement engages.
- **Rule shape:** `reveal.account_visits(page IN [pricing, security]) > 3 within 7d AND account IN open_opps`
- **Source fields:** de-anon tool's event stream (not Webflow's API)

## What we'd ignore
- Aggregate page view counts without account identity
- CMS collection edits (internal marketing ops noise)
- Site publish events
- Form submissions from personal-email domains with no account match

## Effort to wire
- **Adapter LOC estimate:** ~120 LOC (single webhook receiver + domain-to-account join)
- **Time estimate:** 2–3 hours
- **Hardest part:** Reliable email-domain → Salesforce account matching for the join — same problem every adapter has.

## Open questions
1. Is Clearbit Reveal, RB2B, Warmly, or similar already running on checkbox.com? (Determines whether section "IF layered on" is real or vapor.)
2. Which forms are considered high-intent vs. newsletter/gated-content?
3. Is HubSpot's tracking script the de-facto identity layer here — making Webflow signals duplicative of the HubSpot dictionary?
