# Chili Piper — Signal Dictionary

**Category:** Meeting scheduling / inbound concierge
**Role in stack:** Routes form-fills and qualified leads to AEs (Concierge, Handoff, Distro), handles round-robin assignment, reschedules, and no-show recovery. Owns the booking surface for inbound and post-MQL meetings.
**Integration surface:**
- REST API at `https://api.chilipiper.com` (see [developers.chilipiper.com/reference/getting-started](https://developers.chilipiper.com/reference/getting-started)) — API-key auth via the `X-Api-Key` header for service-to-service; OAuth2 for user-context calls. The REST surface is thin (meetings, routes, queues, availability) — lifecycle data is realistically pulled from webhooks, not polled.
- Outbound webhooks per workspace (see [developers.chilipiper.com/reference/webhooks](https://developers.chilipiper.com/reference/webhooks)) — JSON POSTs, HMAC-signed with the workspace secret in `X-ChiliPiper-Signature`, retried with exponential backoff on non-2xx for ~24h.
- Native Salesforce package (managed AppExchange app) writes `Event` and `Task` records with the `ChiliPiper__` namespace, including custom fields like `ChiliPiper__Reschedule_Count__c`, `ChiliPiper__No_Show__c`, `ChiliPiper__Meeting_Type__c`, `ChiliPiper__Router__c`, and `ChiliPiper__Booked_From__c`. We query these directly rather than the API for the SFDC-linked side.
- Native HubSpot integration mirrors meetings to the Meetings object with similar custom properties; relevant only if Checkbox's primary CRM is HubSpot rather than SFDC.

**Pricing/access reality:** Webhook delivery and CRM write-back ship on the standard Concierge / Handoff / Distro tiers. Some event types (notably the granular reschedule/no-show stream with actor attribution) are gated to Concierge Enterprise — confirm at install time. See "Install-time discovery."

## What it emits

Meeting lifecycle webhooks fire on the documented events ([developers.chilipiper.com/reference/webhooks](https://developers.chilipiper.com/reference/webhooks)):

- `meeting.booked`
- `meeting.rescheduled`
- `meeting.canceled`
- `meeting.no_show`
- `meeting.completed`
- `meeting.reassigned` (routing change after booking)
- `route.assigned` (router fires, before any meeting exists)

Each payload carries: `event.type`, `event.id`, `event.created_at`, plus a `meeting` object with `id`, `start_time`, `end_time`, `meeting_type.id`, `meeting_type.name`, `router.id`, `router.name`, `assignee.email`, `assignee.id`, `invitee.email`, `invitee.first_name`, `invitee.last_name`, `invitee.title` (when collected on the form), `invitee.company`, `form_submission.id`, and CRM linkage fields `salesforce.lead_id`, `salesforce.contact_id`, `salesforce.opportunity_id`, `salesforce.account_id` (populated when the router resolved against SFDC at booking time). Reschedule/cancel events add `reschedule_count`, `reschedule_reason`, `reschedule_initiator` (`invitee` | `host` | `admin`), and `previous_start_time`.

The Salesforce sync is the more reliable join key for active opps: Chili Piper writes a structured `Event` per meeting and maintains `ChiliPiper__Reschedule_Count__c` and `ChiliPiper__No_Show__c` on it, so the SFDC mirror gives us opportunity-linked lifecycle without us having to stitch webhooks to opps ourselves.

## Signals we'd extract

### 1. Reschedule streak on active opp — BLOCKING
- **What it is:** Same invitee reschedules a meeting tied to a Selected Vendor opp two or more times in a 14-day rolling window, where at least one reschedule was buyer-initiated.
- **Why for the wedge:** Reschedules at late stage are the cleanest leading indicator of fading buying momentum — champion is dodging, losing internal air cover, or being told to wait by procurement/exec before the next AE conversation. Two in two weeks is past noise.
- **Rule shape:** `event.type=meeting.rescheduled AND count(meeting.rescheduled where invitee.email=X AND reschedule_initiator='invitee' in last 14d) >= 2 AND opp.stage='Selected Vendor' AND opp.amount >= $25k`
- **Source fields:** `event.type`, `invitee.email`, `meeting.id`, `reschedule_count`, `reschedule_initiator`, `salesforce.opportunity_id`, `assignee.email`, `event.created_at`
- **Fallback (if `reschedule_initiator` is null on the tier):** join SFDC `Event` records on `ChiliPiper__Reschedule_Count__c >= 2` and infer initiator from the audit trail (`LastModifiedById` matching the AE user vs. the integration user).

### 2. No-show after stage progression — ACTION
- **What it is:** Buyer skipped a scheduled meeting within 7 days of the opp moving into Selected Vendor.
- **Why for the wedge:** Classic cold-feet pattern — champion advanced us internally, then ghosted when the next conversation got real (likely budget/exec review or a competitor's last pitch landed).
- **Rule shape:** `event.type=meeting.no_show AND opp.stage='Selected Vendor' AND (now - opp.stage_changed_at) <= 7d AND invitee.email IN OpportunityContactRole.email`
- **Source fields:** `event.type`, `invitee.email`, `meeting.start_time`, `salesforce.opportunity_id`, `opp.stage_changed_at` (SFDC), `ChiliPiper__No_Show__c` (SFDC mirror)
- **Note on no-show semantics:** Per Chili Piper's help center, `meeting.no_show` requires the meeting to be marked as no-show — either by the AE in the Chili Piper UI / SFDC, or automatically when integrated with Gong/Zoom and no participant joined. We treat the SFDC `ChiliPiper__No_Show__c` flag as the source of truth and use the webhook as the near-real-time trigger.

### 3. New persona joins the buying committee — AWARENESS
- **What it is:** First-ever meeting booked at an account with an invitee whose title matches Finance, Legal, IT, Security, or Procurement, on an account where prior meetings only included the champion persona.
- **Why for the wedge:** Committee expansion is the signal Checkbox deals most need surfaced early — it tells the AE which late-stage gate is about to open and who to arm the champion against.
- **Rule shape:** `event.type=meeting.booked AND invitee.email NOT IN (prior_meeting_invitees WHERE salesforce.account_id=X) AND classify_persona(invitee.title) IN ('finance','legal','it','security','procurement') AND opp.stage IN ('Discovery','Proposal','Selected Vendor')`
- **Source fields:** `event.type`, `invitee.email`, `invitee.title` (enrich via ZoomInfo if blank on form), `salesforce.account_id`, `meeting_type.name`

## What we'd ignore
- `route.assigned` events without a downstream `meeting.booked` (router noise)
- `meeting.reassigned` (internal RR mechanics — AE swap, not a buyer signal)
- AE-side calendar conflicts and host swaps
- Meetings booked via outbound AE sequences using a personal Chili Piper link (not a buyer-initiated inbound signal — distinguishable via `router.name` / `meeting_type.name` naming convention, confirmed at install)
- `meeting.rescheduled` where `reschedule_initiator='host'` or `'admin'`
- Form-fill routing events without a booked outcome

## Effort to wire
- **Adapter LOC estimate:** ~180 LOC (webhook receiver + HMAC signature verify on `X-ChiliPiper-Signature` + normalizer + 3 rule evaluators + SFDC fallback query for tier-gated fields)
- **Time estimate:** ~3 hours, most of it on the SFDC join to resolve `opportunity_id` and `stage_changed_at` when the webhook lacks CRM linkage (router not CRM-linked at booking time).
- **Hardest part:** Reliably distinguishing buyer-initiated vs. AE-initiated reschedules — `reschedule_initiator` is documented but tier-gated; we'll need the SFDC `Event.LastModifiedById` fallback path wired from day one.

## Install-time discovery
- **Webhook subscription scopes:** Confirm which event types the workspace admin has actually enabled per-router. The Chili Piper UI requires each router to opt into each lifecycle event individually — defaults vary. Need to subscribe explicitly to `meeting.booked`, `meeting.rescheduled`, `meeting.canceled`, `meeting.no_show` across all inbound routers tied to Selected Vendor pipeline.
- **`reschedule_initiator` field availability by tier:** Verify the field is populated on the customer's plan (Concierge vs. Concierge Enterprise). If absent, fall back to the SFDC `Event` audit-trail inference described in Signal 1.
- **SFDC sync fidelity:** Confirm (a) which custom fields the installed Chili Piper managed package version exposes — older installs lack `ChiliPiper__No_Show__c` — and (b) whether the SFDC sync is bidirectional (does marking no-show in SFDC fire `meeting.no_show`?) so we don't double-count.
- **CRM linkage coverage:** Sample 50 recent `meeting.booked` events and measure what % have `salesforce.opportunity_id` populated. Routers not configured with CRM lookup will leave it null and force us through the SFDC `Event.WhoId` → `OpportunityContactRole` join.
- **No-show automation source:** Confirm whether Gong/Zoom auto-no-show is enabled, or whether AEs must manually flag. Determines our latency SLA for Signal 2.
