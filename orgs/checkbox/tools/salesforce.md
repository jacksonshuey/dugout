# Salesforce — Signal Dictionary

**Category:** CRM (system of record)
**Role in stack:** Source of truth for opportunities, contact roles, stage history, and logged activity across the Checkbox sales motion.
**Integration surface:** REST API (sObject + Composite), Bulk API 2.0 for history backfills, Streaming API / Platform Events (PushTopic, ChangeDataCapture) for near-real-time deltas. OAuth 2.0 JWT bearer flow against a Connected App.
**Pricing/access reality:** Requires Enterprise Edition or higher for API access, an admin-installed Connected App with `api` + `refresh_token` scopes, and Field History Tracking enabled on the Opportunity object (max 20 tracked fields — usually already at the limit on mature orgs).

## What it emits
A relational graph of Account → Opportunity → OpportunityContactRole → Contact, plus append-only history sidecars (OpportunityHistory for stage transitions, OpportunityFieldHistory for tracked field edits) and Task/Event records for logged touchpoints. Change Data Capture publishes row-level diffs as Platform Events. The high-leverage surface for late-stage stalls is *change over time*, not snapshots.

## Signals we'd extract

### 1. Stage stagnation at Selected Vendor — BLOCKING
- **What it is:** Opportunity has sat in "Selected Vendor" (or analogous post-champion stage) longer than the historical p75 for that stage, with no forward-motion activity.
- **Why for the wedge:** This is the exact stage where champion buy-in is locked but finance/IT haven't engaged. Time-in-stage is the earliest objective signal of procurement drag.
- **Rule shape:** `if opp.StageName == 'Selected Vendor' AND daysSince(latest OpportunityHistory.CreatedDate where NewValue='Selected Vendor') > 21 AND no Task.CreatedDate in last 7d → fire BLOCKING`
- **Source fields:** `Opportunity.StageName`, `Opportunity.Id`, `OpportunityHistory.NewValue`, `OpportunityHistory.CreatedDate`, `Task.WhatId`, `Task.CreatedDate`

### 2. Close date slip — ACTION
- **What it is:** CloseDate has been pushed out by ≥14 days while the opportunity is in or past "Selected Vendor."
- **Why for the wedge:** A silent CloseDate push is the AE's tell that procurement just told them "next quarter." It almost never gets flagged proactively.
- **Rule shape:** `for row in OpportunityFieldHistory where Field='CloseDate' AND CreatedDate > now-30d: if (NewValue - OldValue) >= 14 days AND opp.StageName in ['Selected Vendor','Negotiation'] → fire ACTION`
- **Source fields:** `OpportunityFieldHistory.Field`, `OpportunityFieldHistory.OldValue`, `OpportunityFieldHistory.NewValue`, `Opportunity.StageName`

### 3. Missing procurement/legal/IT contact role — ACTION
- **What it is:** Opportunity in Selected Vendor with no OpportunityContactRole whose Contact.Title or Contact.Department matches procurement, finance, legal, or IT patterns.
- **Why for the wedge:** The literal definition of the wedge — champion is logged, budget-holder is not. Detectable from CRM structure alone.
- **Rule shape:** `if opp.StageName == 'Selected Vendor' AND count(OpportunityContactRole join Contact where Title ~ /procure|finance|legal|IT|CFO|CIO/i) == 0 AND opp.Amount > $threshold → fire ACTION`
- **Source fields:** `OpportunityContactRole.OpportunityId`, `OpportunityContactRole.ContactId`, `Contact.Title`, `Contact.Department`, `Opportunity.Amount`

### 4. Champion contact departure — BLOCKING
- **What it is:** A Contact with an active OpportunityContactRole (especially IsPrimary=true) is flipped to inactive, or their Email/Title changes in a way consistent with leaving.
- **Why for the wedge:** Losing the champion at Selected Vendor is the textbook silent killer. CRM detects this before ZoomInfo does if reps update records, and ChangeDataCapture catches it instantly.
- **Rule shape:** `subscribe to ContactChangeEvent: if changedFields includes IsActive→false OR Title changed AND contact has active OpportunityContactRole where IsPrimary=true AND opp.StageName in late stages → fire BLOCKING`
- **Source fields:** `ContactChangeEvent`, `Contact.IsActive`, `Contact.Title`, `OpportunityContactRole.IsPrimary`, `OpportunityContactRole.OpportunityId`

## What we'd ignore
- **Task/Event volume metrics** — gameable, reps log activity to look busy; doesn't predict stalls.
- **Lead object entirely** — wedge is post-qualification; Leads aren't in late-stage motion.
- **Chatter feed items** — low signal-to-noise, inconsistent adoption.
- **Forecast/Quota objects** — downstream of the signals we care about, not predictive.
- **Custom fields without an org-specific schema map** — can't generalize; would require per-customer config.

## Effort to wire
- **Adapter LOC estimate:** ~280 LOC — slightly heavier than NewsAPI (~200) due to OAuth refresh, SOQL query building, and Platform Event subscription handling.
- **Time estimate:** 6–8 hours in a clean sandbox; 2+ days against a production org once Connected App approval and field-history-tracking limits enter the picture.
- **Hardest part:** Getting the Connected App approved by a customer's Salesforce admin and confirming the Opportunity fields we depend on (StageName values, CloseDate) are actually history-tracked. Field History Tracking caps at 20 fields per object and is often already full.

## Open questions
- Does Checkbox use standard `StageName` values or a custom picklist where "Selected Vendor" maps to a different label per customer?
- Is Change Data Capture enabled on Contact/Opportunity in target orgs, or do we need to fall back to PushTopic + polling?
- What's the realistic API call budget per customer per day given Salesforce's 24-hour rolling governor limits at their edition tier?
