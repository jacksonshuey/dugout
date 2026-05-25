# Zendesk — Signal Dictionary

**Category:** CS / support
**Role in stack:** Post-sale ticketing system of record; for Dugout, a window into account health on expansion-target accounts and reference customers.
**Integration surface:** Support API v2 (base `https://{subdomain}.zendesk.com/api/v2`), Webhooks API (`/api/v2/webhooks`), Triggers/Automations that fire webhooks via `conditional_ticket_events` subscriptions, OAuth 2.0 or API token + email basic auth ([developer.zendesk.com/api-reference](https://developer.zendesk.com/api-reference/)).
**Pricing/access reality:** Webhooks + Triggers ship on every paid plan (Team and up). Plan-tier rate limits per [Zendesk rate limits docs](https://developer.zendesk.com/api-reference/introduction/rate-limits/): Team 200 rpm, Growth/Professional 400 rpm, Enterprise 700 rpm, Enterprise Plus 2500 rpm; List Tickets endpoint is separately capped at 100 rpm (300 with High Volume add-on). CSAT/satisfaction ratings require Professional+. Trial accounts limited to 10 webhooks. Sandbox is Enterprise-only — free trial workspace fine for the prototype.

## What it emits
Ticket create/update/solve events with `priority` (urgent/high/normal/low), `status` (new/open/pending/hold/solved/closed), `tags`, `requester_id`, `organization_id`, `assignee_id`, `created_at`, `updated_at`, `satisfaction_rating`, and `custom_fields[]` per the [Tickets API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/). Satisfaction ratings via [`/api/v2/satisfaction_ratings`](https://developer.zendesk.com/api-reference/ticketing/ticket-management/satisfaction_ratings/) carry `score` (good/bad/offered/unoffered), `comment`, `reason_id`, `ticket_id`, `requester_id`. Organizations are first-class objects at `/api/v2/organizations` with `domain_names[]`, `tags[]`, `external_id`, and an `organization_fields` hash keyed by admin-defined field keys — that hash is our join key back to Salesforce Account.

## Wedge alignment honesty
Pure support metrics are not Dugout's job. But when the workspace is mid-expansion into a current customer, the customer's live ticket queue IS a Selected Vendor-stage signal — finance won't approve a seat expansion the week IT filed three P1s. Same logic for reference-account health: a degraded reference kills a late-stage deal on a call.

## Signals we'd extract

### 1. Expansion-target ticket spike — BLOCKING
- **What it is:** Open ticket count or P1/P2 volume on an Organization in active expansion (SFDC Opportunity Stage = Proposal/Negotiation, Type = Expansion) jumps >2x trailing-7-day baseline, OR any single `priority = urgent` ticket opens.
- **Why for the wedge:** Expansion deals die when the buyer's own ops team is firefighting. AE needs to know before the next pricing call so they can lead with the fix, not the upsell.
- **Rule shape:** `opportunity.stage IN ('Proposal','Negotiation') AND opportunity.type = 'Expansion' AND (count(tickets WHERE priority = 'urgent' AND status NOT IN ('solved','closed')) >= 1 OR count(tickets created_at > now-7d) >= 2 * baseline_28d)`.
- **Source fields:** `ticket.priority`, `ticket.status`, `ticket.organization_id`, `ticket.created_at` (see [Tickets API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/)), joined to SFDC Opportunity via `organization.organization_fields.sfdc_account_id`.
- **Delivery:** Webhook subscription on `zen:event-type:ticket.created` and `ticket.priority_changed` posted to Dugout via [`/api/v2/webhooks`](https://developer.zendesk.com/api-reference/webhooks/webhooks-api/webhooks/) with signing-secret verification; baseline computed nightly via `GET /api/v2/organizations/{id}/tickets`.

### 2. Champion filed an angry ticket — BLOCKING
- **What it is:** A contact mapped as Champion or Economic Buyer on an open opportunity is the `requester_id` on a new ticket with `priority IN ('high','urgent')`, OR submits a satisfaction rating with `score = 'bad'`.
- **Why for the wedge:** Your internal advocate is silently pissed. This is the highest-signal, lowest-volume event Zendesk produces for sales.
- **Rule shape:** `user.email (resolved from ticket.requester_id) IN (opportunity.contacts WHERE role IN ('Champion','EB')) AND (ticket.priority IN ('high','urgent') OR satisfaction_rating.score = 'bad')`.
- **Source fields:** `ticket.requester_id` → `GET /api/v2/users/{id}` → `user.email`; `ticket.priority`; `satisfaction_rating.score` + `satisfaction_rating.comment` from [`/api/v2/satisfaction_ratings`](https://developer.zendesk.com/api-reference/ticketing/ticket-management/satisfaction_ratings/).
- **Delivery:** Webhook on `ticket.created` filtered server-side by a Zendesk Trigger condition `requester.tags includes "champion"` (set at install time) so we don't fan out every ticket. CSAT side uses a separate Trigger on "Satisfaction → Bad" firing a webhook with the rating payload.

### 3. Reference-account health degradation — AWARENESS
- **What it is:** An Organization tagged as a sales reference (`organization.organization_fields.reference_status = 'active'`) experiences CSAT drop below 80% rolling-30d OR `escalation` tag applied to any ticket in last 14 days.
- **Why for expansion plays:** Stops the AE from putting a now-unhappy customer on a reference call. Weekly digest, not interrupt-driven.
- **Rule shape:** `organization.organization_fields.reference_status = 'active' AND (csat_30d < 0.80 OR 'escalation' IN ticket.tags WHERE ticket.updated_at > now-14d)`.
- **Source fields:** `organization.organization_fields` (custom hash, see [Organizations API](https://developer.zendesk.com/api-reference/ticketing/account-configuration/organizations/)), `satisfaction_rating.score` aggregated, `ticket.tags`.
- **Delivery:** Nightly batch — `GET /api/v2/organizations` filtered locally on `reference_status`, then `GET /api/v2/satisfaction_ratings?start_time={epoch_30d_ago}` and `GET /api/v2/organizations/{id}/tickets` for the tag check.

## What we'd ignore
- First-response time, resolution time, agent SLAs — CS Ops dashboards.
- Ticket volume on net-new prospects (they're not customers yet).
- Internal-only tickets, agent reassignments, macro usage, view counts.
- Help Center / knowledge base article views and analytics.
- CSAT on closed-lost accounts.
- `ticket.recent`, side conversations, CC/follower churn — noise for sales.

## Effort to wire
- **Adapter LOC estimate:** ~250 LOC — Express/Next webhook receiver with HMAC signature verification against `signing_secret` (retrievable from `GET /api/v2/webhooks/{id}/signing_secret`), Organization/User → SFDC Account resolver, 3 rule evaluators, and a nightly cron for the awareness signal.
- **Time estimate:** 1.5 days, half of which is the identity-resolution join.
- **Hardest part:** Mapping Zendesk Organizations to Salesforce Accounts. Domain matching against `organization.domain_names[]` gets ~80% coverage; the long tail needs either `organization.external_id` set to the SFDC Account ID at install (cleanest) or a custom `sfdc_account_id` key in `organization_fields` that someone backfills. Rate-limit-wise the List Tickets cap of 100 rpm means the nightly batch must paginate by org rather than scanning all tickets, and respect `Retry-After` on 429s.

## Install-time discovery
- **SFDC linking field:** Confirm whether the customer already populates `organization.external_id` (preferred — single field, indexed) or needs a new custom organization field `sfdc_account_id` provisioned via Admin Center → Objects and rules → Organization fields. The field key becomes the lookup path: `organization.organization_fields.sfdc_account_id`. If neither exists, install creates the custom field and a one-time backfill script keyed off domain match.
- **CSAT trigger config:** Verify a Trigger exists for "Satisfaction rating updated → score is Bad" posting to the Dugout webhook endpoint. If the customer is on Professional+ but hasn't enabled CSAT surveys (`satisfaction_rating.score` will be `"unoffered"` across the board), the champion-CSAT half of Signal 2 degrades to priority-only and we lean harder on `escalation` tags.
- **Champion-tag convention:** Decide where champion identity lives. Cleanest is a Zendesk user tag `champion` synced from SFDC Contact Role nightly so the Trigger can filter server-side and we don't webhook every ticket. Fallback: email-join from SFDC OpportunityContactRole at evaluation time — works but misses ticket requesters using personal-alias emails.
