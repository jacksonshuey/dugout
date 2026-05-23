# Swyft AI — Signal Dictionary

> **Swyft is the substrate that makes Salesforce-based MEDDPICC rules fire.** Dugout reads the populated Salesforce fields; Swyft is responsible for keeping them fresh. This card documents an upstream dependency, not a signal source.

**Category:** Post-call AI agent for CRM hygiene (MEDDIC/MEDDPICC, next steps, churn risk, competitor mentions auto-extracted from call transcripts and written back to Salesforce/HubSpot).
**Role in stack:** Closes the "MEDDPICC fields are empty because reps don't fill them in" gap. Swyft listens to call recordings via Gong/Chorus/Zoom/Salesloft, extracts structured deal metadata, and writes it to the customer's existing Salesforce custom fields under the rep's OAuth identity.
**Integration surface for Dugout:** None directly. Swyft has no public webhook spec or REST API for downstream consumers — its output surface is the CRM itself. Dugout reads downstream from Salesforce.
**Pricing/access reality:** Sales-led, no public pricing tier. SOC-2 Type II. Help center documents setup flows; no developer documentation.

## Architectural role for Dugout

Dugout's wedge rule — "Selected Vendor stalled" — depends on Salesforce custom fields (`Economic_Buyer__c`, `Decision_Criteria__c`, `Paper_Process__c`, `Next_Steps__c`, `Competitor__c`) being populated and recent. At most B2B orgs those fields are >60% null because reps don't type MEDDPICC into Salesforce after every call. Swyft solves that upstream by ingesting Gong/Chorus/Zoom/Salesloft recordings, extracting MEDDIC/MEDDPICC entities, and writing them back to the customer's existing field schema via Salesforce OAuth (under the rep's permissions — Swyft cannot bypass validation rules or sharing). The "signal" Dugout cares about is therefore the **presence, freshness, and last-modified-by identity** of structured deal metadata in Salesforce, which Swyft is responsible for keeping current. Without Swyft (or an equivalent), the rules below are theoretically sound but practically null-dominated.

## Call sources Swyft ingests

Confirmed from help center + Salesloft AppDirectory listing + G2:

- **Gong** — Swyft registers as an automation rule in Gong (Company Settings → Ecosystem → Automation Rules) and reads call details, transcripts, and recordings via Gong's API after each call lands.
- **Chorus (ZoomInfo)** — Same pattern; Swyft pulls completed call transcripts.
- **Zoom** — Direct ingestion when a Swyft meeting bot is invited to the call (Meeting Bot Setup Guides exist in help center).
- **Salesloft** — Per the Salesloft AppDirectory listing, Swyft "automatically receives the call recording" from Salesloft Cadence/Conversations and routes extracted MEDDIC fields, customer concerns, churn risks, and next steps to the CRM.
- **Outreach** — Mentioned in Swyft marketing as supported; integration depth not documented publicly.

For Dugout: **install-time we need to confirm which of these Checkbox actually has Swyft connected to.** If Checkbox calls happen on Zoom but Swyft is only wired to Gong, gaps in field freshness map to "no Gong recording" not "no Swyft run."

## CRM targets Swyft writes to

- **Salesforce** (primary) — Opportunity, Account, Contact objects, via OAuth under the connecting user. Field mapping is per-customer: Swyft maps its extracted entities (Economic Buyer, Metrics, Decision Criteria, Decision Process, Paper Process, Identified Pain, Champion, Competition, Next Steps, Customer Concerns, Churn Risk) to whichever custom field API names the org already uses. No standardized schema — Checkbox-specific.
- **HubSpot** — Deal properties + contact/company records. Same pattern, customer-defined property mapping.
- **Slack** — Notifications fired post-call (deal alerts, handoff docs). Not relevant to Dugout — we have our own digest layer.

Swyft's "single-click confirm" UX means reps can either let Swyft auto-write or review/approve each extracted update. That affects the freshness model — see install-time discovery below.

## Signals Dugout extracts (indirectly, via Salesforce)

### 1. MEDDPICC field staleness at Selected Vendor — BLOCKING
- **What it is:** Opportunity sits in Selected Vendor with `Economic_Buyer__c`, `Decision_Criteria__c`, or `Paper_Process__c` empty, OR last-modified >14 days. Means either no recent call happened, Swyft couldn't extract it from the call, or the rep declined the suggested update.
- **Why for the wedge:** Selected Vendor is where deals stall on procurement/finance/legal. Missing Economic Buyer = no escalation path when redlines arrive.
- **Rule shape:** `stage = "Selected Vendor" AND (Economic_Buyer__c IS NULL OR Decision_Criteria__c.LastModifiedDate > 14d)`
- **Source fields:** Salesforce Opportunity custom fields populated by Swyft (org-specific API names).

### 2. Next Steps decay — ACTION
- **What it is:** Swyft writes `Next_Steps__c` after each call. If not refreshed in 7+ days on an active late-stage deal, the deal is going cold regardless of logged activity.
- **Why for the wedge:** "Activity exists" lies; "next step is fresh and specific" is the real heartbeat. Late-stage deaths typically show stale next steps for 2–3 weeks before Closed Lost.
- **Rule shape:** `stage IN (late_stages) AND Next_Steps__c.LastModifiedDate > 7d`
- **Source fields:** Next Steps field + `LastModifiedDate` + (ideally) `LastModifiedById` to confirm the update came from Swyft's connected user, not a rep cosmetically touching the field.

### 3. Competitor mentioned mid-cycle — AWARENESS
- **What it is:** Swyft extracts competitor names from transcripts into a Competitor/Competitive Threat field. New value appearing after `stage >= "Proposal"` often precedes a bake-off.
- **Why for the wedge:** Late-stage competitor introduction is a budget-justification signal — the champion is being asked to defend the choice.
- **Rule shape:** `Competitor__c changed AND stage >= "Proposal"`
- **Source fields:** Competitor / Competitive Threat custom field.

## What Dugout ignores

- Swyft's admin metrics (extraction confidence, model version, audit log of which fields it edited)
- Swyft's Slack notifications (Dugout owns its own digest)
- Raw call transcripts (Gong/Chorus is the canonical source if we ever need them)
- Meeting summaries (narrative, not structured)
- Handoff docs Swyft generates (separate post-sale workflow)

## Effort to wire

- **Adapter LOC:** Zero net new. Dugout already reads Salesforce; Swyft just populates fields we'd be reading regardless.
- **Time estimate:** 0 hours of code. ~2 hours of config to map Checkbox's actual custom field API names into Dugout's rule definitions, plus ~30 min with RevOps to confirm which call sources Swyft is connected to.
- **Hardest part:** Naming. Swyft writes to whatever custom field names the org defined; nothing is standardized. Without a 15-min RevOps call, Dugout can't write its rules against the right API names.

## Install-time discovery

1. **Field naming.** What are Checkbox's actual Salesforce custom field API names for the MEDDPICC slots Swyft populates? (Could be `Economic_Buyer__c`, `Decision_Maker__c`, `Champion_Name__c`, `MEDDPICC_EB__c` — org-defined.)
2. **Call source coverage.** Which of {Gong, Chorus, Zoom, Salesloft, Outreach} is Swyft actually connected to at Checkbox? Determines whether "field empty" means "no Swyft run" vs "Swyft ran and found nothing."
3. **Write attribution.** Does Swyft write under a dedicated integration user or under the connecting rep's identity? Drives whether `LastModifiedById = swyft_user` is a usable filter to distinguish AI-populated values from rep-edited ones.
4. **Auto-write vs review-first mode.** If Checkbox uses Swyft's single-click confirm UX, "Swyft ran" doesn't guarantee "field updated" — reps can decline. Need to know default mode to calibrate the staleness threshold.
5. **Multi-thread coverage.** Does Swyft write to all contacts on the Opportunity or only the primary? Affects whether "Champion identified" is a per-Opp or per-Contact signal.
