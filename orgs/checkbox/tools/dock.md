# Dock — Signal Dictionary

**Category:** Deal rooms (digital sales rooms)
**Role in stack:** The single workspace where the late-stage buying committee (champion, finance, legal, IT, exec sponsor) actually touches Checkbox's pricing, MSA, SOC 2, and mutual action plan — i.e., where Selected Vendor either converts or rots.
**Integration surface:** Native two-way Salesforce sync (engagement activity written back to Opportunity/Contact), native HubSpot sync, native Slack notifications, Zapier triggers (room created, room visited, asset viewed). Public REST/webhook API exists but is gated — partner/enterprise tier; not self-serve documented on dock.us. No public OpenAPI spec.
**Pricing/access reality:** Direct API/webhook access requires Business or Enterprise plan plus a partner conversation. Realistic path on a 2-week interview build: pull engagement events out of Salesforce (where Dock already writes them as Tasks + custom fields on the Opportunity) rather than hitting Dock directly. Treat Dock as a Salesforce-relayed source for v1.

## What it emits
Per-user, per-asset engagement: viewer email, viewer domain, room ID, asset ID and type (pricing PDF, security questionnaire, MSA, MAP, video, link), open timestamp, time-on-asset, return-visit count, and room-level rollups (last activity, distinct viewers, viewer-by-role if tagged). Also room lifecycle events (created, shared, asset added/replaced) and CTA actions (e-sign opened, form submitted).

## Why this tool is load-bearing for the wedge
Selected Vendor stage at Checkbox is a deal-room-heavy phase by definition: security review, legal redlines, procurement scoping, and exec sign-off all happen against documents Dock hosts. **Silence in the deal room IS the early warning signal** — every other tool in the stack (Gong, Outreach, HubSpot) tells you what was said or sent; Dock tells you whether the people who actually approve the deal are reading. If Finance never opens pricing and Legal never opens the MSA, the deal is dead 14 days before AE realizes. No other integration in the Checkbox stack sees this. This is the flagship.

## Signals we'd extract

### 1. Buying-committee gap — BLOCKING
- **What it is:** Opportunity at Selected Vendor (or later) for ≥5 days, room is live, and a contact with role = Finance, Legal, IT, or Economic Buyer has zero asset opens on the critical asset for their role (Finance → pricing; Legal → MSA; IT → security questionnaire).
- **Why for the wedge:** This is the literal mechanism by which Selected Vendor deals die — the approvers were never engaged. Catching this on day 5 instead of day 25 is the entire product thesis.
- **Rule shape:** `stage == "Selected Vendor" AND days_in_stage >= 5 AND room_exists AND (role_contact.opens[critical_asset] == 0 OR role_contact == null)` → BLOCKING, Slack DM to AE.
- **Source fields:** SFDC Opportunity.StageName, Opportunity.LastModifiedDate, OpportunityContactRole.Role, Dock Task (synced) `Asset_Viewed__c`, `Viewer_Email__c`, `Asset_Type__c`, `Viewed_At__c`.

### 2. Champion engagement drop-off — BLOCKING (ACTION if <7d)
- **What it is:** Primary champion (OpportunityContactRole.IsPrimary = true) had ≥3 room visits in prior 14 days, then zero visits for ≥7 days while opportunity is open and post-Demo.
- **Why for the wedge:** Champion ghosting is the #1 leading indicator of internal stall. Tier by silence duration: 4–6 days = ACTION (nudge), ≥7 days = BLOCKING (champion likely lost or reorged).
- **Rule shape:** `champion.visit_count(last_14d_excluding_last_7d) >= 3 AND champion.visit_count(last_7d) == 0 AND opp.stage in {Demo, Selected Vendor, Verbal}` → tier by gap length.
- **Source fields:** Dock Task records on Contact, `Viewed_At__c` timestamps, OpportunityContactRole.IsPrimary, Opportunity.StageName.

### 3. Unknown viewer from buyer org — ACTION
- **What it is:** New email accessed the room whose domain matches the Account's primary domain but isn't on any existing Contact for the Opportunity.
- **Why for the wedge:** Usually means procurement just got looped in, a new exec is reviewing, or champion forwarded to a peer. All three change the deal — AE needs to identify and add them to MEDDPICC within 24h.
- **Rule shape:** `viewer.domain == account.primary_domain AND viewer.email NOT IN opp.contacts.email` → ACTION, prompt AE to identify role.
- **Source fields:** Dock `Viewer_Email__c`, Account.Website, Contact.Email on Opportunity.

### 4. Critical asset staleness — ACTION
- **What it is:** Pricing PDF opened exactly once by the economic buyer in the last 21 days during Selected Vendor stage with MEDDPICC Decision Criteria marked complete.
- **Why for the wedge:** A one-and-done pricing view from the EB means the number didn't land — they're either shopping it or stalled internally on budget. Trigger a value-reinforcement play.
- **Rule shape:** `asset.type == "pricing" AND viewer == economic_buyer AND open_count(last_21d) == 1 AND days_since_last_open >= 7 AND stage == "Selected Vendor"` → ACTION.
- **Source fields:** Dock `Asset_Type__c`, `Viewer_Email__c`, `Viewed_At__c`, MEDDPICC custom fields on Opportunity.

### 5. MSA opened but no return after redline window — AWARENESS
- **What it is:** Legal contact opened MSA once, no return visit in 10+ days, no e-sign event.
- **Why for the wedge:** Legal is sitting on it. Surfaces in weekly digest with suggested counsel-to-counsel nudge.
- **Rule shape:** `asset.type == "MSA" AND legal_contact.opens == 1 AND days_since_open >= 10 AND esign.completed == false`.
- **Source fields:** Same as above + Dock `Esign_Status__c`.

## What we'd ignore
- Views from `@checkbox.com` or any internal Checkbox domain.
- Asset opens with time-on-asset < 30 seconds (link-preview bots, email scanners).
- Repeat opens from the AE's own sharing actions.
- Room-created events without subsequent buyer activity (noise during AE setup).
- Viewer domains matching known email-security vendors (Mimecast, Proofpoint, Barracuda scanners).

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC for the Salesforce-relayed path (SOQL query on Dock-synced custom objects/Tasks, normalize to `DockEngagementEvent`, write to `signals.dock_events`). ~400 LOC if going direct to Dock webhooks once partner access is granted.
- **Time estimate:** 1.5 days via Salesforce relay; 4 days direct once webhook access exists (HMAC verification, replay handling, asset/role mapping).
- **Hardest part:** Mapping Dock viewer emails to OpportunityContactRole roles reliably — if Contact doesn't exist yet (unknown viewer signal), we need a domain-match + role-inference step. Second hardest: confirming Dock's Salesforce package actually writes per-asset events (not just room-level rollups) on the customer's tier.

## Open questions
1. Does Dock's Salesforce managed package write per-asset view events, or only aggregate "last activity" timestamps? If aggregate-only, signals 1 and 4 degrade significantly.
2. Webhook event catalog — is there a `room.asset.viewed` event with viewer identity, or only `room.visited`?
3. How does Dock represent anonymous/pre-identification viewers (someone opens before entering email)? Do we lose signal 3?
4. Rate limits on the direct API if/when granted — can we backfill 90 days of history for existing open opps on day one?
