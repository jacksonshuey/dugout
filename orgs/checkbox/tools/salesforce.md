# Salesforce — Signal Dictionary

## Category
CRM (system of record). Salesforce is the durable graph; every other tool in the stack — HubSpot, Outreach, Gong, Chili Piper, Dock — either writes back into it or is reconciled against it. For Dugout, Salesforce is the primary substrate for any signal that needs a stable Opportunity identity.

## Role in stack
Source of truth for the Account → Opportunity → OpportunityContactRole → Contact graph, plus the time-series sidecars (`OpportunityHistory`, `OpportunityFieldHistory`) that turn snapshot CRM into a changelog. At Checkbox specifically: the late-stage stall thesis ("dies at Selected Vendor") is provable only against Salesforce, because the stage label, the close-date slip, the missing budget-holder contact role, and the champion's `IsActive` flag all live here. Other tools (Gong, Outreach) provide *evidence* about the deal; Salesforce provides the *spine* the evidence hangs on.

## Integration surface
- **REST sObject + Composite API** for synchronous reads/writes against `/services/data/vXX.X/sobjects/Opportunity/{Id}` and SOQL via `/query?q=…`. Composite lets us batch up to 25 subrequests per call — useful for hydrating an Opportunity plus its ContactRoles plus its open Tasks in one round trip.
- **Bulk API 2.0** for backfills (per API Basics module: dedicated 30-min unit). Async, CSV-based, designed for the "load 90 days of OpportunityHistory" first-run case rather than steady-state.
- **Pub/Sub API (gRPC, HTTP/2)** for Change Data Capture and Platform Events. Salesforce now explicitly recommends Pub/Sub over the legacy CometD Streaming API for CDC and platform events (per Streaming API intro: "efficiently publishes and delivers binary event messages"). We default to Pub/Sub and only fall back to CometD if a customer's edition or network egress posture blocks gRPC.
- **CometD / Bayeux long-poll Streaming API** as the fallback for PushTopic and generic events when Pub/Sub isn't viable.
- **OAuth 2.0 JWT bearer flow** against a Connected App with `api` + `refresh_token` scopes. JWT bearer (not web-server) so we can run headless and survive customer admins rotating the runtime user without a re-consent dance.

## Pricing/access reality
- API access requires Enterprise Edition or higher (per CDC intro: CDC is available in "Enterprise, Performance, Unlimited, and Developer editions"). Professional Edition customers can't host us without buying the API add-on, which is a $25/user/mo line item and a real deal-blocker on smaller orgs.
- **API call budget:** Enterprise baseline is "100,000 + 1,000 per Salesforce license" per 24-hour rolling window (per Platform API limits cheat sheet). A 50-seat Checkbox customer gives us 150K calls/day shared with every other integration on the org. Our adapter has to operate inside the leftover headroom, which in practice means CDC-first (one subscription, server-pushed) rather than poll-first.
- **Field History Tracking:** capped at 20 fields per object org-wide. On mature Salesforce orgs this cap is usually already at or near the limit, and our adapter cannot demand more slots — it has to detect which of `StageName`, `CloseDate`, `Amount`, `ForecastCategory`, `Probability`, `OwnerId` are actually tracked and degrade gracefully (or push the customer to the Field Audit Trail add-on, which lifts retention to 10 years but doesn't lift the 20-field cap).
- **History retention:** `OpportunityFieldHistory` retains 18 months by default, up to 10 years with the Field Audit Trail add-on (per Object Reference: OpportunityFieldHistory). `OpportunityHistory` has no equivalent cap because it's a snapshot table, not a per-field audit trail.

## What it emits
A relational graph (Account → Opportunity → OpportunityContactRole → Contact, with OpportunityLineItem hanging off Opportunity for ACV detail) plus three distinct change streams that are easy to conflate:

1. **`OpportunityHistory`** — a snapshot table. Every insert or update to an Opportunity writes a new row capturing `StageName`, `Amount`, `CloseDate`, `ExpectedRevenue`, `ForecastCategory`, `Probability` at that instant, keyed by `OpportunityId` + `CreatedDate` (per Object Reference: OpportunityHistory). Read-only, SOQL-queryable. This is the right source for "how did stage and amount co-evolve."
2. **`OpportunityFieldHistory`** — a per-field audit log. Only writes a row for fields explicitly enabled in Field History Tracking, with `Field`, `OldValue`, `NewValue` (both typed `anyType`), `CreatedById`, `CreatedDate` (per Object Reference: OpportunityFieldHistory). This is the right source for "exact prior value of CloseDate before the slip."
3. **CDC `OpportunityChangeEvent`** — Pub/Sub events with a `ChangeEventHeader` carrying `entityName`, `recordIds`, `changeType` (CREATE/UPDATE/DELETE/UNDELETE plus GAP_* variants and GAP_OVERFLOW), `changedFields`, `nulledFields`, `diffFields`, `transactionKey`, `sequenceNumber`, `commitTimestamp`, `commitUser`, `changeOrigin` (per CDC ChangeEventHeader reference). The right source for "tell me the instant a champion's IsActive flips."

The high-leverage surface for late-stage stalls is the intersection of (2) and (3): field-level diffs delivered in near-real-time with a stable transaction key for dedupe.

## Signals we'd extract

### 1. Stage stagnation at Selected Vendor — BLOCKING
- **What it is:** Opportunity sitting in the discovered "Selected Vendor" stage longer than the org's historical p75 dwell time for that stage, with no forward-motion activity (no Task, Event, or Opportunity edit by the AE in the last 7 days).
- **Why for the wedge:** This is the exact stage where champion buy-in is locked but finance/IT haven't engaged. Time-in-stage is the earliest *objective* signal of procurement drag — it precedes the close-date slip by days or weeks.
- **Rule shape:** `if Opportunity.StageName == <discovered_selected_vendor_label> AND now - max(OpportunityHistory.CreatedDate where NewStageName==current_stage) > org_p75_dwell AND no Task.CreatedDate where Task.WhatId==opp.Id in last 7d → fire BLOCKING`. We compute `org_p75_dwell` per customer from a 12-month `OpportunityHistory` backfill (one Bulk API 2.0 job at install) and refresh weekly.
- **Source fields:** `Opportunity.StageName`, `Opportunity.Id`, `Opportunity.LastStageChangeDate`, `OpportunityHistory.StageName`, `OpportunityHistory.CreatedDate`, `Task.WhatId`, `Task.CreatedDate`, `Event.WhatId`, `Event.CreatedDate`.

### 2. Close date slip — ACTION
- **What it is:** `CloseDate` pushed out by ≥14 days while the opportunity is in or past Selected Vendor, detected as a single edit or cumulative across multiple edits in a 30-day window.
- **Why for the wedge:** A silent `CloseDate` push is the AE's tell that procurement just told them "next quarter." Almost never gets surfaced proactively because no one's job is to diff yesterday's pipeline against today's.
- **Rule shape:** subscribe to `OpportunityChangeEvent`; when `ChangeEventHeader.changedFields` contains `CloseDate`, look up `OpportunityFieldHistory` for the matching `transactionKey`/`CreatedDate` to get typed `OldValue`/`NewValue`, then `if (NewValue - OldValue) >= 14 days AND Opportunity.StageName in [discovered late-stage labels] → fire ACTION`. CDC tells us *what* changed instantly; `OpportunityFieldHistory` gives us the *typed prior value* CDC doesn't carry in the header.
- **Source fields:** `OpportunityChangeEvent.ChangeEventHeader.changedFields`, `OpportunityChangeEvent.ChangeEventHeader.commitTimestamp`, `OpportunityFieldHistory.Field`, `OpportunityFieldHistory.OldValue`, `OpportunityFieldHistory.NewValue`, `Opportunity.StageName`.

### 3. Missing procurement/legal/IT contact role — ACTION
- **What it is:** Opportunity in Selected Vendor (or later) with no `OpportunityContactRole` whose joined `Contact.Title` or `Contact.Department` matches procurement/finance/legal/IT/security patterns.
- **Why for the wedge:** The literal mechanical definition of the wedge — champion is logged, budget-holder is not. Fully detectable from CRM structure with one SOQL join, no NLP, no external enrichment.
- **Rule shape:** `if Opportunity.StageName in [discovered late-stage labels] AND Opportunity.Amount > org_threshold AND count(OpportunityContactRole oc JOIN Contact c ON oc.ContactId = c.Id WHERE oc.OpportunityId = opp.Id AND (c.Title ~ /procure|finance|legal|IT|security|CFO|CIO|CISO|CPO|controller/i OR c.Department ~ /finance|legal|IT|procurement|security/i)) == 0 → fire ACTION`. We re-evaluate on `OpportunityContactRoleChangeEvent` and `ContactChangeEvent` so it self-clears when the rep adds the right person.
- **Source fields:** `OpportunityContactRole.OpportunityId`, `OpportunityContactRole.ContactId`, `OpportunityContactRole.IsPrimary`, `OpportunityContactRole.Role`, `Contact.Title`, `Contact.Department`, `Opportunity.Amount`, `Opportunity.StageName`.

### 4. Champion contact departure — BLOCKING
- **What it is:** A Contact with an active `OpportunityContactRole` (especially `IsPrimary=true`) flips `IsActive` to false, or `Title`/`Email` changes in a way consistent with leaving (domain change, title containing "former," etc.).
- **Why for the wedge:** Losing the champion at Selected Vendor is the textbook silent killer. CDC fires this before ZoomInfo's job-change feed catches up — often the rep updates the CRM the day they hear it on a call, and we want that signal within minutes, not the weekly ZoomInfo refresh later.
- **Rule shape:** subscribe to `ContactChangeEvent` on the standard CDC channel; `if ChangeEventHeader.changeType == 'UPDATE' AND ('IsActive' in changedFields AND new Contact.IsActive == false) OR ('Email' in changedFields AND domain(new) != domain(old)) AND EXISTS (OpportunityContactRole WHERE ContactId = recordId AND IsPrimary = true AND Opportunity.StageName in [discovered late-stage labels]) → fire BLOCKING`. We use `ChangeEventHeader.transactionKey` to dedupe against the eventual `OpportunityContactRoleChangeEvent` that the rep often fires moments later.
- **Source fields:** `ContactChangeEvent.ChangeEventHeader.changeType`, `ContactChangeEvent.ChangeEventHeader.changedFields`, `Contact.IsActive`, `Contact.Title`, `Contact.Email`, `OpportunityContactRole.IsPrimary`, `OpportunityContactRole.OpportunityId`, `Opportunity.StageName`.

## What we'd ignore
- **Task/Event volume metrics** — gameable; reps log activity to look busy. `Opportunity.LastActivityDate` is useful as a recency floor but not as a stall predictor.
- **Lead object entirely** — wedge is post-qualification; Leads aren't in late-stage motion. We don't subscribe to `LeadChangeEvent`.
- **Chatter (`FeedItem`, `FeedComment`)** — low signal-to-noise, inconsistent adoption across customers.
- **Forecast and `OpportunityForecast` objects** — downstream of the signals we already extract; ForecastCategory shifts are interesting only as a corroborator, not a primary trigger.
- **Custom fields without the install-time schema map** — we don't guess at `Procurement_Status__c` or `Legal_Review_Date__c` even when they're obviously relevant. Either the customer maps them at install or we don't read them.
- **GAP_OVERFLOW events** treated as data, not signals — they indicate CDC fell behind and we need to replay via `OpportunityHistory` SOQL backfill, not fire a notification.

## Effort to wire
- **Adapter LOC estimate:** ~280 LOC. Heavier than NewsAPI (~200) because of OAuth JWT refresh, SOQL builder, Pub/Sub gRPC client + CometD fallback, and `ChangeEventHeader` dedupe logic on `transactionKey` + `sequenceNumber`.
- **Time estimate:** 6–8 hours in a Developer Edition sandbox (free, full CDC support per CDC intro), 2+ days against a production customer org once Connected App approval, IP allowlisting on the customer side, and the Field History Tracking audit are in the critical path.
- **Hardest part:** not the code — it's getting the Connected App approved by a customer's Salesforce admin and confirming that the four fields our signals depend on (`StageName`, `CloseDate`, `Amount`, `OwnerId`) are actually in the customer's 20-field history tracking budget. We pre-empt this with an install-time describe + sample query that reports back exactly which signals will work on day one.

## Install-time discovery
Salesforce orgs vary enough that a "configure once" adapter is fiction. Our install flow runs these discovery steps and persists the results to the per-customer adapter config, so the runtime never guesses:

- **Stage label mapping.** We `SELECT MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder` and present the picklist to the customer admin during install, asking them to tag which stage equals "Selected Vendor" and which stages count as "late-stage" for signal 3 and 4 gating. `StageName` is a fully admin-customizable picklist; assuming the standard values would silently break every signal on every non-default org.
- **Field History Tracking audit.** We describe `OpportunityFieldHistory` and query a sample (`SELECT Field, COUNT(Id) FROM OpportunityFieldHistory WHERE CreatedDate = LAST_N_DAYS:90 GROUP BY Field`) to confirm `StageName`, `CloseDate`, `Amount`, `OwnerId` are actually producing rows. If `CloseDate` isn't tracked, signal 2 degrades from "exact slip in days" to "CDC-only detection that *something* about CloseDate changed" and we tell the admin so during install rather than silently shipping a worse signal.
- **CDC entitlement and channel selection.** We verify the org's edition is Enterprise+ (per CDC intro: required for CDC at all) and that `OpportunityChangeEvent`, `OpportunityContactRoleChangeEvent`, and `ContactChangeEvent` are selected in the standard CDC channel. If the customer is at or past their standard-channel entity cap, we fall back to a custom channel (requires their admin to create it) or, last resort, to CometD PushTopic + 60s polling on `SystemModstamp`.
- **API call budget reservation.** We read the org's edition and license count and compute the 24-hour API ceiling as `100,000 + 1,000 × licenses` (per Platform API limits cheat sheet). Adapter throttles itself to a configurable percentage of that — default 15% — leaving room for the customer's own integrations. CDC consumption doesn't count against the REST API limit, which is the main reason we prefer it.
- **Custom field map (optional).** If the customer wants signals against `Procurement_Status__c` or similar, they map those at install. The runtime never auto-discovers custom fields, because misinterpreting a custom picklist is a worse failure mode than ignoring it.
- **OAuth Connected App scope confirmation.** We assert `api` and `refresh_token` scopes on the JWT we receive at install and store the `instance_url` returned — Salesforce hashes orgs across multiple pod domains and hardcoding `login.salesforce.com` for runtime calls is a known gotcha.
