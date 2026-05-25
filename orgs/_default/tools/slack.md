# Slack — Signal Dictionary

**Category:** Team comms (internal handoff + flagging)
**Role in stack:** The internal nervous system around the deal. Distinct from Outreach (external email to buyers) and Gong (external calls with buyers) — Slack is where the workspace's *own* people talk *about* the deal. AE pings SE for a KPI assessment, manager flags an opp in `#deals-at-risk`, RevOps comments on a hygiene gap in `#sales-ops`, CS posts an escalation in a customer-named channel. None of that lands in Salesforce unless someone retypes it.
**Integration surface:** Slack Web API (`conversations.history`, `conversations.list`, `users.list`, `users.info`) + Events API (`message.channels`, `message.groups`, `app_mention`, `reaction_added`) via either HTTP endpoints or Socket Mode. OAuth 2.0 with a bot token; user token only if Dugout needs to read content the bot isn't a member of (we shouldn't). Cursor-paginated history; per-channel time-windowed pulls. **Rate limit (verified):** Tier 3 for `conversations.history` on Marketplace apps — 50+ req/min. Non-Marketplace commercial apps were throttled to **1 req/min, 15 messages/req** as of May 29 2025, which makes Marketplace approval a hard prerequisite for any real customer.
**Pricing/access reality:** Slack itself is on the customer's Business+ or Enterprise Grid plan (the spec doesn't pin which). The app side is free to build but ships through Slack Marketplace review (~2–4 weeks) if we want the un-throttled rate limit. Enterprise Grid adds a separate install model — apps install per workspace by default, with org-level install requiring admin approval and a different scope set; shared channels carry cross-workspace user IDs that need translation. None of this is hard, but it's not the "paste an API key" experience Granola has — it's a real OAuth dance with a real Marketplace listing.

## What it emits

Channel and DM message streams: `channel_id`, `ts`, `thread_ts`, `user`, `text`, `blocks`, `files[]`, `reactions[]`, `permalink`, `edited`, `metadata`. Plus user directory (`id`, `name`, `real_name`, `profile.email`, `team_id`, `is_bot`) and conversation directory (`id`, `name`, `is_channel`, `is_private`, `is_im`, `is_mpim`, `topic`, `purpose`, `members`). Pull model: Events API for new messages in opted-in channels (sub-second), `conversations.history` poll for backfill and any channel where webhook delivery was missed.

## Signals we'd extract

Four signals, all internal-perspective. Slack is honestly **mid-tier wedge fit** — the spec is explicit that Slack should usually be a confidence booster, not the sole source for high-severity customer-facing signals. These four are the ones worth wiring because they catch process failures no other tool sees.

### 1. `handoff_requested_no_completion` — BLOCKING (the demo signal)
- **What it is:** AE asks SE/CS/legal for a deal-specific deliverable in a channel or thread ("can you do a KPI assessment for Acme by Thursday?", "@se-team need security questionnaire help on Acme"), and within N business days there is no completion signal — no reply with the asset, no Salesforce attachment, no Dock asset upload, no follow-up message from the requested party.
- **Why for the wedge:** This is the literal demo example from spec §1.4: *"Slack shows the AE asked the SE for a KPI assessment, but there is no completed handoff."* Selected Vendor stalls partly because internal teammates drop the ball on what the buyer asked for. Catching the dropped handoff is the rare case where Slack is genuinely the only source.
- **Rule shape:** Haiku classifies messages in opted-in deal channels for handoff-request shape (verb + role mention + deal name); cross-checks for completion signals on the same `(account, request_type)` tuple within window; fires if none.
- **Source fields:** `message.text`, `message.user`, `message.channel_id`, `message.thread_ts`, `users.profile.email` (to resolve role), account name matching against `accounts.name` and `accounts.domain`.
- **Canonical type:** `data_hygiene_gap` (internal-process failure, not buyer behavior).

### 2. `internal_risk_flag` — ACTION
- **What it is:** An internal employee posts a deal-risk-shaped message in a channel that mentions a known account, without a corresponding Salesforce Close Date push, Stage regression, or Next Step update within 48h. Phrasings: "Acme is wobbly", "I'm worried about renewal at Acme", "Acme keeps rescheduling", "champion at Acme went quiet".
- **Why for the wedge:** Reps and managers verbalize concern in Slack before they admit it in CRM. The lag between "AE flags risk in #pipeline-review" and "AE updates the Forecast Category" is exactly the visibility gap Dugout exists to close.
- **Rule shape:** Haiku classifies for risk-language + account-name match; joins to Salesforce to detect whether the rep updated the opp; fires if the Slack flag exists and the CRM is silent.
- **Canonical type:** `momentum_change` (direction: negative).

### 3. `customer_channel_silence` — AWARENESS
- **What it is:** A customer-named or customer-shared Slack channel (e.g., `#acme-<workspace>`, a Slack Connect channel with the buyer) has zero buyer-side messages for ≥14 days during an active implementation or expansion cycle. Distinguishes by `user.team_id` ≠ the workspace's team to detect buyer vs internal activity.
- **Why for the wedge:** For deals already won, this is the renewal/expansion early warning — buyer disengagement in the shared channel predates the renewal conversation by months. For active deals in Selected Vendor with a Connect channel, it's an additional disengagement source layered with Dock and Outreach (Pattern 3 in the index).
- **Rule shape:** Channel allowlist flags customer-named/shared channels at install time; cron counts buyer-team messages per 14d window; fires when count = 0 on an active account.
- **Canonical type:** `account_health_decline` (or `champion_disengagement` if the silent party maps to a named Contact).

### 4. `committee_gap_mentioned_internally` — ACTION
- **What it is:** An internal employee says in Slack that the deal needs someone the buying committee doesn't have yet: "we still don't have a Finance contact at Acme", "need to get Legal looped in on Acme MSA", "no IT person on the Acme calls". Internal acknowledgment of a committee gap that hasn't been resolved in Salesforce OCR.
- **Why for the wedge:** Reps often *know* the gap before they document it. This signal catches the "the AE already realizes the problem" case, which routes differently than a Granola-detected gap (where the AE may not realize) — here the prompt is "you flagged this 6 days ago, here's a play to actually fix it" rather than "did you notice this?"
- **Rule shape:** Haiku classifies for role-gap language + account match; cross-checks `OpportunityContactRole` for the named role; fires if internally mentioned AND still absent from OCR after 7d.
- **Canonical type:** `committee_gap`.

## What we'd ignore

- **DMs and private channels** by default — never sync unless explicitly opted in per channel by an admin. This is the privacy gate.
- Channels not on the allowlist — `#random`, `#general`, social channels, HR/people channels, exec-only channels, anything with no deal context.
- Bot messages (`is_bot: true`) — Slack notification spam from Salesforce, Outreach, Datadog, etc., is just relay noise we already see at the source.
- Reactions alone — emoji on a message doesn't carry enough signal to classify; we read reactions only as context attached to a classified message.
- Files and attachments content — file *existence* matters for the handoff-completion check; we don't OCR PDFs uploaded to Slack.
- Edits and deletions older than 7 days — we snapshot at ingest; backfilling edit history is a privacy hazard.
- Threads on messages we never classified — if the parent didn't trip a rule, the thread doesn't get pulled.

## Effort to wire

Slack is enterprise-grade OAuth with a real Marketplace listing, but the adapter itself is mechanically straightforward:

- `lib/slack-client.ts` — Web API wrapper with Tier 3 throttle + cursor pagination (~80 LOC)
- `lib/slack-events.ts` — Events API webhook handler with 3-second ACK requirement; Socket Mode fallback for dev (~70 LOC)
- `lib/slack-classifier.ts` — Haiku 4.5 extracting the 4 signal types, with account-name matching against `accounts.name`/`accounts.domain` (~100 LOC)
- `lib/slack-adapter.ts` — orchestrator (allowlist filter → user/account resolve → classify → handoff-completion correlation window → upsert) (~80 LOC)
- `app/actions/slack.ts` — server actions (OAuth start/callback, channel allowlist UI submit, sync now, disconnect)
- `app/api/slack/events/route.ts` — Events API endpoint with URL verification + signature verification
- `app/api/slack/oauth/callback/route.ts` — OAuth callback
- `components/slack-channel-allowlist.tsx` — install-time UI listing all channels with a checkbox control per channel (default all unchecked)
- `supabase/migrations/<date>_slack_integration.sql` — workspace_integrations row + `slack_channels_allowed` table + Vault entry for bot token

**Estimate: ~280 LOC, 1.5–2 days** including Marketplace listing prep. Cleanest if it inherits the Granola Vault-encrypted token pattern verbatim — Slack tokens go in `vault.secrets` exactly like Granola API keys, just with two of them (bot + app-level for Socket Mode).

## Install-time discovery

- **Channel allowlist — the privacy gate.** After OAuth, surface every channel the bot can see (public + any private channels the installing admin manually invites the bot to). Default state: **zero channels checked**. Admin opts in per channel. Nothing syncs until at least one channel is checked. This mirrors Granola's folder-allowlist pattern and is the install-time gesture that makes Slack ingest defensible to Security.
- **Never sync DMs or MPIMs**, full stop. We do not request `im:history` or `mpim:history` scopes at all. If a customer asks for DM ingestion later, that's a separate scope addition + a separate consent UI; v1 ships without it.
- **Bot must be invited to private channels** before they appear in the allowlist — Slack's own scope model enforces this. Document the `/invite @dugout` step.
- **Enterprise Grid:** if the customer is on Grid, decide at install time whether to install per-workspace (default, simpler) or org-wide (requires admin approval, gets the cross-workspace shared-channel view). Most customers want per-workspace for the primary sales workspace.
- **User → role → internal-employee resolution.** Match `users.profile.email` domain against the workspace's corporate domain to tell internal vs buyer. Match individual emails against `workspace_users.email` to resolve role (AE, SE, CS, RevOps, Manager). Unmatched internal-domain users drop into an unassigned bucket for one-click role tagging.
- **Account-name matching.** Channel name parsing (`#acme-*`, `#customer-acme`) plus message-body fuzzy match against `accounts.name` and `accounts.domain`. Manual override per channel ("this channel is about Acme") for ambiguous cases.
- **Marketplace approval status** — if not yet approved, the rate limit makes real-time impractical; ship in poll-only mode at 1 req/min on a per-channel rotation, and warn the admin.

## Mapping the 4 Slack signals to the 12 canonical types

| Slack signal | Canonical `signal_type` | `direction` |
|---|---|---|
| `handoff_requested_no_completion` | `data_hygiene_gap` | negative |
| `internal_risk_flag` | `momentum_change` | negative |
| `customer_channel_silence` | `account_health_decline` | negative |
| `committee_gap_mentioned_internally` | `committee_gap` | negative |

**Honest framing:** all four are *internal-process* signals about the workspace's own behavior around the deal, not buyer signals. That's why Slack is Tier B for the wedge — it's the corroborating layer that explains *why* a deal is stuck (the team dropped a handoff, the rep already knows it's wobbly, no one ever asked Finance) rather than the primary detector. Per spec §6.3: *"Slack should usually be a confidence booster, not the sole source for high-severity customer-facing signals."* The one exception is `handoff_requested_no_completion`, which is genuinely BLOCKING because no other tool sees it.
