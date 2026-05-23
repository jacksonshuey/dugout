# Chili Piper — Signal Dictionary

**Category:** Meeting scheduling
**Role in stack:** Inbound concierge — routes form-fills and qualified leads to AEs, handles round-robin, reschedules, and no-show recovery.
**Integration surface:** REST API (api.chilipiper.com), outbound webhooks per workspace, OAuth2 + API key auth, native Salesforce sync (writes Event + Task records).
**Pricing/access reality:** Webhook delivery and CRM write-back are on standard "Concierge" / "Handoff" tiers; the documented REST API is thin and lifecycle data is realistically pulled from webhooks or via the Salesforce Event mirror Chili Piper already maintains.

## What it emits
Meeting lifecycle webhooks fire on booked, rescheduled, canceled, no-show, and completed, each carrying invitee email, assignee (AE), routing queue, meeting type, source form, opportunity/account IDs (when CRM-linked), and a reschedule/cancel reason. Round-robin and routing decisions are also emitted but are mostly internal. The Salesforce sync writes a structured Event with Chili Piper custom fields (`cp_reschedule_count__c`, `cp_no_show__c`) we can query directly without hitting their API.

## Signals we'd extract

### 1. Reschedule streak on active opp — BLOCKING
- **What it is:** Same invitee reschedules a meeting tied to a Selected Vendor opp two or more times in a 14-day rolling window.
- **Why for the wedge:** Reschedules at late stage are the cleanest leading indicator of fading buying momentum — champion is dodging or losing internal air cover before procurement engages.
- **Rule shape:** `event.type=meeting.rescheduled AND count(meeting.rescheduled where invitee.email=X in last 14d) >= 2 AND opp.stage='Selected Vendor' AND opp.amount >= $25k`
- **Source fields:** `event.type`, `invitee.email`, `meeting.id`, `meeting.reschedule_count`, `meeting.opportunity_id`, `meeting.assignee.email`, `timestamp`

### 2. No-show after stage progression — ACTION
- **What it is:** Buyer skipped a scheduled meeting within 7 days of the opp moving into Selected Vendor.
- **Why for the wedge:** Classic cold-feet pattern — champion advanced us internally, then ghosted when the next conversation got real (likely budget/exec review).
- **Rule shape:** `event.type=meeting.no_show AND opp.stage='Selected Vendor' AND (now - opp.stage_changed_at) <= 7d AND invitee.email IN OpportunityContactRole.email`
- **Source fields:** `event.type`, `invitee.email`, `meeting.scheduled_at`, `meeting.opportunity_id`, `opp.stage_changed_at` (from SFDC)

### 3. New persona joins the buying committee — AWARENESS
- **What it is:** First-ever meeting booked at an account with an invitee whose title matches Finance, Legal, IT, Security, or Procurement, on an account where prior meetings only included the champion persona.
- **Why for the wedge:** Committee expansion is the signal Checkbox deals most need surfaced early — it tells the AE which late-stage gate is about to open and who to arm the champion against.
- **Rule shape:** `event.type=meeting.booked AND invitee.email NOT IN (prior_meeting_invitees WHERE account_id=X) AND classify_persona(invitee.title) IN ('finance','legal','it','security','procurement') AND opp.stage IN ('Discovery','Proposal','Selected Vendor')`
- **Source fields:** `event.type`, `invitee.email`, `invitee.title` (enriched if missing), `meeting.account_id`, `meeting.type`

## What we'd ignore
- Round-robin assignment / reassignment events (internal mechanics)
- AE-side calendar conflicts and host swaps
- Meetings booked via outbound AE sequences (not a buyer-initiated signal)
- Reschedules initiated by the AE (`reschedule_initiator=host`)
- Form-fill routing events without a booked outcome

## Effort to wire
- **Adapter LOC estimate:** ~180 LOC (webhook receiver + signature verify + normalizer + 3 rule evaluators)
- **Time estimate:** ~3 hours, most spent on the SFDC join to resolve `opportunity_id` and `stage_changed_at`
- **Hardest part:** Reliably distinguishing buyer-initiated vs. AE-initiated reschedules — the field exists but is inconsistently populated; may need to fall back on inferring from the actor email domain.

## Open questions
- Does the webhook payload expose `reschedule_initiator` on every tier, or only Concierge+?
- Is `meeting.opportunity_id` always populated when the lead has a matched SFDC opp, or only when booked through a CRM-linked router?
- Are no-show events fired automatically post-meeting, or do they require the AE to mark the meeting as such in the Chili Piper UI?
