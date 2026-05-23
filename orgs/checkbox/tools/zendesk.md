# Zendesk — Signal Dictionary

**Category:** CS / support
**Role in stack:** Post-sale ticketing system of record; for Dugout, a window into account health on expansion-target accounts and reference customers.
**Integration surface:** REST API (Support API v2), Webhooks (native, JSON payloads), Triggers/Automations (server-side filters that fire webhooks), Events API for ticket audit trail, OAuth 2.0.
**Pricing/access reality:** Webhooks + Triggers ship on every paid plan (Team and up). Read API is generous (700 req/min on Enterprise, lower on Team). CSAT data requires Professional+. Sandbox available on Enterprise only — for the prototype, a free trial workspace is fine.

## What it emits
Ticket create/update/solve events with priority, status, tags, requester, organization, and assignee. Satisfaction ratings (good/bad + comment) when CSAT surveys return. Side conversations, internal notes, and CC/follower changes via the Events endpoint. Organizations and Users are first-class objects — the join key back to a Salesforce Account.

## Wedge alignment honesty
Pure support metrics are not Dugout's job. But when Checkbox is mid-expansion into a current customer, the customer's live ticket queue IS a Selected Vendor-stage signal — finance won't approve a seat expansion the week IT filed three P1s. Same logic for reference-account health: a degraded reference kills a late-stage deal on a call.

## Signals we'd extract

### 1. Expansion-target ticket spike — BLOCKING
- **What it is:** Open ticket count or P1/P2 volume on an Organization in active expansion (Stage = Proposal/Negotiation in SFDC, Type = Expansion) jumps >2x trailing-7-day baseline, OR any single P1 opens.
- **Why for the wedge:** Expansion deals die when the buyer's own ops team is firefighting. AE needs to know before the next pricing call so they can lead with the fix, not the upsell.
- **Rule shape:** Account in expansion AND (open_p1_count >= 1 OR new_tickets_7d >= 2 * baseline_28d).
- **Source fields:** `ticket.priority`, `ticket.status`, `ticket.organization_id`, `ticket.created_at`, joined to SFDC Opportunity stage/type.

### 2. Champion filed an angry ticket — BLOCKING
- **What it is:** A contact mapped as Champion or Economic Buyer on an open opportunity is the `requester_id` on a new ticket with priority >= high, OR leaves a CSAT rating of "bad."
- **Why for the wedge:** Your internal advocate is silently pissed. This is the highest-signal, lowest-volume event Zendesk produces for sales.
- **Rule shape:** ticket.requester.email IN (opportunity.contacts WHERE role IN ('Champion','EB')) AND (priority IN ('high','urgent') OR satisfaction_rating.score = 'bad').
- **Source fields:** `ticket.requester_id` -> `user.email`, `ticket.priority`, `satisfaction_rating.score`, `satisfaction_rating.comment`.

### 3. Reference-account health degradation — AWARENESS
- **What it is:** An Organization tagged as a sales reference (custom org field `reference_status = active`) experiences a CSAT drop below 80% rolling-30d OR escalation tag applied.
- **Why for expansion plays:** Stops the AE from putting a now-unhappy customer on a reference call. Weekly digest, not interrupt-driven.
- **Rule shape:** org.reference_status = 'active' AND (csat_30d < 0.80 OR 'escalation' IN ticket.tags within 14d).
- **Source fields:** `organization.organization_fields.reference_status`, `ticket.satisfaction_rating`, `ticket.tags`.

## What we'd ignore
- First-response time, resolution time, agent SLAs — CS Ops dashboards.
- Ticket volume on net-new prospects (they're not customers yet).
- Internal-only tickets, agent reassignments, macro usage, view counts.
- Knowledge base article views and Help Center analytics.
- CSAT on closed-lost accounts.

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC — webhook receiver + Organization/User -> SFDC Account resolver + 3 rule evaluators.
- **Time estimate:** 1.5 days, half of which is the identity-resolution join.
- **Hardest part:** Mapping Zendesk Organizations to Salesforce Accounts. Domain matching gets ~80% coverage; the long tail needs a manual override table or a custom `sfdc_account_id` org field that someone has to backfill.

## Open questions
- Does Checkbox tag champion contacts in Zendesk, or only in SFDC? If only SFDC, the champion-ticket rule needs an email join that may miss aliases.
- Are reference accounts maintained as a list anywhere, or would Dugout need to introduce the `reference_status` custom field itself?
- CSAT response rates at Checkbox's scale — if <15%, the reference-degradation signal is too sparse and we lean on escalation tags instead.
