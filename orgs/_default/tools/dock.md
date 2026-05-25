# Dock — Signal Dictionary

**Category:** Deal rooms (digital sales rooms) / buyer-engagement workspace
**Role in stack:** The single workspace where the late-stage buying committee (champion, finance, legal, IT, exec sponsor) actually touches the workspace's pricing, MSA, SOC 2, mutual action plan, and order form — i.e., where Selected Vendor either converts or rots. **This is the flagship wedge tool: silence in the deal room IS the early warning signal.**

## Architecture — Salesforce-relay is THE integration

Dock's primary mechanism for surfacing engagement to other systems is its **native two-way Salesforce sync**, which writes every per-buyer workspace event to Salesforce as a standard `Task` record on the linked Account/Opportunity/Contact. Dugout reads Dock engagement out of Salesforce — there is no separate Dock integration to build for v1. This is not a workaround; it is how Dock's customers are expected to consume engagement data outside the Dock UI.

Confirmed event taxonomy that lands in Salesforce as Tasks (per Dock's product docs and the Internal Tab launch post):
- **Workspace views** (room-level visit, per viewer)
- **Video views** (per asset, per viewer)
- **Link clicks** (per asset, per viewer)
- **Downloads** (per asset, per viewer)
- **Task completions** (MAP/checklist items completed by buyer)
- **Order form completions** (line items, terms, and PDFs also sync as structured data + attachment, with line items mappable to Salesforce Pricebook products)

Each Task carries the Dock event category in `Task.Type` (Dock added Salesforce **Task Type** mapping specifically so these events can be categorized — e.g. "Video View", "Asset Click", "Workspace Visit"). That's the lookup key Dugout pivots on. `WhoId` (Contact) and `WhatId` (Opportunity/Account) link the engagement to the deal. `Task.Subject` carries the asset name. `Task.ActivityDate` is the engagement timestamp.

**Pricing/access reality:** Dock's direct REST API and webhooks (`developers.dock.us/webhooks/introduction`) are **Enterprise-tier, early-access only**, available by request through Customer Success. For v1 we do not need them — the Salesforce Task relay covers every signal in this card. Direct API access stays in scope as a v2 upgrade path if (a) the customer is already on Enterprise tier and (b) we want sub-minute latency or pre-Salesforce-sync events.

**Two-way sync surface (Salesforce → Dock):** Account and Opportunity fields populate workspace dynamic variables (customer name, logo, emails, key dates, custom fields). Opportunity stage changes can auto-create workspaces. Pricebook products back the order form line items. Dugout does not need to write back — we only consume.

## What it emits (as it lands in Salesforce)

Per-user, per-asset engagement Tasks on the matched Opportunity/Account/Contact: viewer email (resolved to Contact if it matches, otherwise raw email on Task description), viewer domain, workspace ID, asset name and category (pricing PDF, security questionnaire, MSA, MAP item, video, link, order form), event timestamp (`Task.ActivityDate`), and the categorized `Task.Type`. Order form completions additionally write structured line items and the executed PDF as an attachment. Workspace-level rollups (last activity, distinct viewers) are available in Dock's own reports but not strictly needed — Dugout reconstructs rollups from the Task stream itself, which is more reliable.

## Why this tool is load-bearing for the wedge

Selected Vendor stage at this workspace is a deal-room-heavy phase by definition: security review, legal redlines, procurement scoping, exec sign-off, and order-form execution all happen against documents Dock hosts. Every other tool in the workspace's stack (Gong, Outreach, HubSpot) tells you what was said or sent; Dock tells you whether the people who actually approve the deal are reading. If Finance never opens pricing and Legal never opens the MSA, the deal is dead 14 days before AE realizes. No other integration in the stack sees this — Dock's per-asset, per-viewer Task stream in Salesforce is the only place this signal lives.

## Signals we'd extract

### 1. Buying-committee gap — BLOCKING
- **What it is:** Opportunity at Selected Vendor (or later) for ≥5 days, workspace is live, and a contact with role = Finance, Legal, IT, or Economic Buyer has zero Dock Tasks of the asset type matching their role (Finance → pricing or order form; Legal → MSA; IT → security questionnaire) on the linked Account/Opportunity.
- **Why for the wedge:** This is the literal mechanism by which Selected Vendor deals die — the approvers were never engaged. Catching this on day 5 instead of day 25 is the entire product thesis.
- **Rule shape:** `Opportunity.StageName == 'Selected Vendor' AND days_in_stage >= 5 AND workspace_linked AND COUNT(Task WHERE Type IN ('Video View','Asset Click','Workspace Visit') AND WhoId == role_contact.Id AND Subject MATCHES critical_asset_for_role) == 0` → BLOCKING, Slack DM to AE.
- **Source fields:** SFDC `Opportunity.StageName`, `Opportunity.LastModifiedDate`, `OpportunityContactRole.Role`, `Task.Type`, `Task.Subject`, `Task.WhoId`, `Task.WhatId`, `Task.ActivityDate`.

### 2. Champion engagement drop-off — BLOCKING (ACTION if <7d)
- **What it is:** Primary champion (`OpportunityContactRole.IsPrimary = true`) had ≥3 Dock Tasks of type Workspace Visit / Video View / Asset Click in prior 14 days, then zero such Tasks for ≥7 days while opportunity is open and post-Demo.
- **Why for the wedge:** Champion ghosting is the #1 leading indicator of internal stall. Tier by silence duration: 4–6 days = ACTION (nudge), ≥7 days = BLOCKING (champion likely lost or reorged).
- **Rule shape:** `champion.task_count(last_14d_excluding_last_7d) >= 3 AND champion.task_count(last_7d) == 0 AND opp.stage IN {Demo, Selected Vendor, Verbal}` → tier by gap length.
- **Source fields:** `Task` records on Contact (`WhoId`), `Task.ActivityDate`, `OpportunityContactRole.IsPrimary`, `Opportunity.StageName`.

### 3. Unknown viewer from buyer org — ACTION
- **What it is:** New email appears in a Dock-generated Task's description/subject whose domain matches the Account's primary domain but isn't on any existing Contact for the Opportunity. (Dock writes the raw viewer email into Task metadata even when no Salesforce Contact match exists — that's the hook.)
- **Why for the wedge:** Usually means procurement just got looped in, a new exec is reviewing, or champion forwarded to a peer. All three change the deal — AE needs to identify and add them to MEDDPICC within 24h.
- **Rule shape:** `extract_email(Task.Description) WHERE Task.WhatId == opp.Id AND domain(email) == account.primary_domain AND email NOT IN opp.contacts.email` → ACTION, prompt AE to identify role.
- **Source fields:** `Task.Description` (Dock writes viewer email here when Contact match fails), `Account.Website`, `Contact.Email` on Opportunity.

### 4. Critical asset staleness — ACTION
- **What it is:** Pricing PDF or order form opened exactly once by the economic buyer in the last 21 days during Selected Vendor stage with MEDDPICC Decision Criteria marked complete.
- **Why for the wedge:** A one-and-done pricing view from the EB means the number didn't land — they're either shopping it or stalled internally on budget. Trigger a value-reinforcement play.
- **Rule shape:** `Task.Subject MATCHES ('Pricing' OR 'Order Form') AND Task.WhoId == economic_buyer.Id AND COUNT(matching_tasks last 21d) == 1 AND days_since_last_task >= 7 AND stage == 'Selected Vendor'` → ACTION.
- **Source fields:** `Task.Subject`, `Task.WhoId`, `Task.ActivityDate`, MEDDPICC custom fields on Opportunity.

### 5. MSA opened but no return after redline window — AWARENESS
- **What it is:** Legal contact has exactly one Dock Task referencing the MSA asset, no return Task in 10+ days, and no order-form-completion Task on the same Opportunity (order form completion is Dock's proxy for execution-ready).
- **Why for the wedge:** Legal is sitting on it. Surfaces in weekly digest with suggested counsel-to-counsel nudge.
- **Rule shape:** `Task.Subject MATCHES 'MSA' AND legal_contact.task_count == 1 AND days_since_task >= 10 AND NOT EXISTS(Task WHERE Type == 'Order Form Completed' AND WhatId == opp.Id)`.
- **Source fields:** Same as above + presence/absence of `Task.Type = 'Order Form Completed'` on the Opportunity.

## What we'd ignore
- Tasks where `Task.Description` viewer email matches the workspace's own corporate domain(s) (internal viewers).
- Tasks with duration metadata < 30 seconds where present (link-preview bots, email scanners).
- Tasks generated by the AE's own sharing actions (Dock tags actor in event metadata — filter where actor == workspace owner).
- Workspace-created Tasks without any subsequent buyer-side activity Task within 48h (noise during AE setup).
- Viewer domains matching known email-security vendors (Mimecast, Proofpoint, Barracuda scanners).

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC. SOQL query on `Task` filtered by `Task.Type` values that Dock writes (configurable list — discovered at install time), join to `OpportunityContactRole` and `Account`, normalize to `DockEngagementEvent`, write to `signals.dock_events`.
- **Time estimate:** 1.5 days end-to-end on the Salesforce-relay path. A direct webhook path (if Enterprise + early-access is granted) would add ~2 days for HMAC verification, replay handling, and event-to-Salesforce reconciliation — not on v1 scope.
- **Hardest part:** Mapping Dock viewer emails to `OpportunityContactRole` reliably when Dock writes the raw email into `Task.Description` instead of resolving to `WhoId` (the unknown-viewer signal). Domain-match + role-inference fallback handles this. Second hardest: confirming the customer's Dock install has Salesforce Task Type mapping enabled — without it, every event is `Task.Type = null` and we have to regex on `Task.Subject` instead.

## Install-time discovery
Concrete SOQL/queries to run against the customer's Salesforce during Dugout install to confirm the Dock data shape:

1. **Confirm Dock Task volume and categorization:**
   `SELECT Type, COUNT(Id) FROM Task WHERE CreatedBy.Name LIKE '%Dock%' OR Description LIKE '%dock.us%' GROUP BY Type ORDER BY COUNT(Id) DESC LIMIT 50` — establishes the actual `Task.Type` enum Dock is writing on this tenant and confirms volume is non-zero on open opps.
2. **Confirm per-asset granularity vs. rollup-only:**
   `SELECT Subject, Type, ActivityDate FROM Task WHERE WhatId IN (SELECT Id FROM Opportunity WHERE IsClosed = false AND StageName = 'Selected Vendor') AND (CreatedBy.Name LIKE '%Dock%' OR Description LIKE '%dock.us%') ORDER BY ActivityDate DESC LIMIT 200` — verifies each asset view generates its own Task (required for signals 1, 4, 5) rather than a single daily rollup.
3. **Confirm viewer-email capture for unknown viewers:**
   Sample 20 Dock Tasks where `WhoId IS NULL` and inspect `Description` for the email-extraction regex target (required for signal 3).
4. **Confirm order-form Task type exists:**
   `SELECT Subject, Type FROM Task WHERE Type LIKE '%Order Form%' OR Subject LIKE '%Order Form%' LIMIT 20` — confirms execution-ready event is captured (required for signal 5's negative condition).
5. **API-tier check (only if pursuing v2 direct webhook path):**
   Ask customer's Dock admin: "Are you on Enterprise tier with API/webhooks early access enabled?" If yes, request OAuth credentials + `developers.dock.us` webhook endpoint provisioning. If no, the Salesforce-relay path is fully sufficient.
