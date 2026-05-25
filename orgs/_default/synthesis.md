# Synthesis — The Unified Signal Model

> **Workspace-level instantiation of the Dugout product.** The general-purpose product spec lives at [`dugout_product_spec_v_0_1.md`](../../../dugout_product_spec_v_0_1.md) (3,495 lines, 16 sections). That spec defines the canonical ontology, integration input map, and module catalog for *any* Dugout customer. This doc takes that ontology and grounds it in a representative 13-tool stack — what the 5 spec namespaces (`admin` / `raw` / `core` / `graph` / `intel`) actually look like when wired to Salesforce, Gong, Dock, Outreach, Granola, etc., plus the 12-signal-type taxonomy and cross-source correlation patterns that drive the Selected Vendor wedge.

> The relational backbone. Every signal from every source — internal SaaS or live-world — fits one shape. That shape is the product.
> **For what this schema actually MEASURES — the Selected Vendor Health Score formula and the case-derived metrics it powers — see [metrics.md](metrics.md)** *(backstop, not the lead demo pitch)*.

## The thesis

**Dugout's product is anti-cold-meetings** — a centralized intelligence layer so no AE walks into a buyer conversation under-informed. The Selected Vendor wedge is the demo anchor; the schema below is what makes the broader product possible.

The 13 per-tool dictionaries describe **49 distinct signals across 13 internal operating systems** (12 representative GTM tools + Granola, which is actually built), plus 3 live-world adapters already in production (NewsAPI, SEC EDGAR, inbound email). Without synthesis they're 46+ dashboards. With synthesis they're a single queryable model where any signal can corroborate any other, any new source plugs into the same shape, and any cross-source correlation becomes a defensible product feature.

This document defines:
1. The **canonical signal taxonomy** (12 signal types every source-signal maps to — the workspace's opinionated cut; the spec doesn't define one)
2. The **5-namespace ontology** (admin / raw / core / graph / intel — per spec §4)
3. The **tiered storage model** (hot / warm / cold — complements spec's raw/core split)
4. The **relational schema** for `intel` (Postgres / Supabase tables — `signals`, `signal_correlations`, `rules`)
5. The **module → ontology mapping** (which of the spec's 14 modules need which canonical objects)
6. The **correlation queries** that turn raw signals into compounded confidence
7. The **AI query layer** (tool-use over the unified store)
8. The **identity resolution** problem — the hardest practical work
9. The **migration story** from Dugout's current state
10. The **products** this unlocks

If `dictionary.md` is the input catalog and the spec is the blueprint, **this is the operating system**.

---

## 1. The canonical signal taxonomy

All 49 source-signals collapse into **12 canonical signal types**. The signal_type is the abstraction that makes cross-source correlation possible — different tools observing the same underlying phenomenon get the same `signal_type`, even though their raw payloads differ. Polarity (good news vs bad news) is carried on the `direction` field of each signal, not in the type name — so `momentum_change` with `direction='positive'` is "next step committed" and `direction='negative'` is "stage stagnated."

The spec defines `signal_definitions` (a global library) and `signal_instances` (detected occurrences) but is intentionally schema-agnostic about *naming* — the 12 types below are the workspace's opinionated cut. They map cleanly onto `signal_definitions.name`.

| `signal_type` | What it means | Sources that observe it | Tiers |
|---|---|---|---|
| `champion_loss` | Primary champion left, fired, deactivated, or is unreachable | ZoomInfo (job change), Salesforce (Contact.IsActive flip), Outreach (bounce/opt-out), Nooks (wrong-person cluster) | BLOCKING |
| `champion_disengagement` | Champion still present but going dark | Dock (room visit drop-off), Outreach (reply latency decay), Gong (sentiment cliff), HubSpot (lifecycle regression), Chili Piper (reschedule streak) | ACTION → BLOCKING |
| `committee_gap` | Required persona (Finance/Legal/IT/Procurement) absent from deal | Salesforce (missing OCR), Dock (asset never opened), Gong (no participant on call), Swyft (Economic Buyer field empty), **Granola (`finance_mentioned_not_engaged`, `it_mentioned_not_engaged`)** | ACTION → BLOCKING |
| `committee_expansion` | New buying-committee member surfaced | HubSpot (new contact form fill), Dock (unknown buyer-org viewer), Outreach (net-new prospect reply), Chili Piper (first meeting w/ new persona), ZoomInfo (new buyer hired), Webflow (form from new contact at named account) | ACTION |
| `momentum_change` | Anything that moves the deal's momentum — stage moves, slips, next-step commits, missed/postponed meetings, objections raised. Polarity on `direction`. | Salesforce (stage transitions, close-date slip), Chili Piper (no-show, reschedule streak), Gong (no next step / next step committed), Swyft (next steps decay), HubSpot (dormant-deal reengagement), **Granola (`objection_raised`, `next_step_committed`, `champion_signal`)** | ACTION → BLOCKING |
| `competitive_threat` | Buyer is evaluating a competitor mid-cycle | Gong (tracker hit), Swyft (Competitor field added), HubSpot (`/vs/` page view), Nooks (AI summary mention), **Granola (`competitor_named`)** | ACTION |
| `shadow_research` | Buyer activity outside known channels — diligence happening you don't see | HubSpot (form fill from new contact at active-opp domain), Dock (unknown viewer), ZoomInfo (intent surge, WebSights anon visit), Webflow (high-intent form) | ACTION → BLOCKING |
| `account_health_decline` | Existing customer in trouble — kills expansion deals and reference plays | Zendesk (ticket spike, champion angry ticket, reference degradation), Xero (payment health degradation, customer downgrade) | ACTION → BLOCKING |
| `lifecycle_milestone` | Time-based event tied to an account or deal | Xero (renewal window, first invoice), ZoomInfo (intent_surge_cold on no-pipeline ICP account), **Granola (`timeline_signal`)** | AWARENESS → ACTION → BLOCKING by proximity |
| `account_context` | External world reporting about a specific account — anything in the news layer that the AE should know before walking in | NewsAPI (live), SEC EDGAR (live), inbound email when classified to a specific account | AWARENESS → ACTION |
| `vertical_context` | Industry-level intel — trends, regulations, competitor moves at the category level, not tied to one account. Powers the "vertical their clients live in" framing. | Inbound newsletter inbox (live), market intel pipeline (live) | AWARENESS |
| `data_hygiene_gap` *(future-state)* | Structured deal metadata is missing or stale — rules can't fire reliably. **No live adapter produces this yet; defined for when Swyft is wired.** | Swyft (MEDDPICC field staleness), Salesforce (missing contact roles) | BLOCKING for rule viability |

**Why this matters:** when 3 different tools observe `champion_loss` on the same account in 14 days, that's not 3 alerts — it's *one event* with high confidence. The signal_type is the join key.

**Why 12, not 10:** earlier drafts had 10. The two adds (`account_context`, `vertical_context`) cover the *live* live-world feeds — NewsAPI, SEC, inbound newsletter — that already ship today but didn't have a home in the deal-focused taxonomy. The `momentum_change` rename absorbs the awkward "positive momentum_stall" case (next step committed, champion signaled strength) by leaning on the existing `direction` field rather than fighting it with naming.

---

## 2. The 5-namespace ontology

The spec organizes everything into 5 namespaces (§4.2). The workspace adopts them verbatim — they're the right cut. Within each namespace, this section lists the canonical objects, names the 5–8 most important fields per object, and notes which tools feed it.

For full field-level definitions of every object, link to the spec section in the header. This doc gives the operator's view, not the schema dump.

### 2.1 `admin` namespace — multi-tenancy backbone

The plumbing that lets one Dugout deployment serve N customers. Per spec §4.3.

| Object | Purpose | Key fields |
|---|---|---|
| `workspaces` | The customer company (each customer = 1 workspace) | `id`, `name`, `domain`, `gtm_motion`, `primary_icp`, `primary_crm`, `timezone` |
| `workspace_users` | Internal users (AE / SDR / Manager / RevOps / SE / CS) | `workspace_id`, `email`, `role`, `team_id`, `crm_user_id`, `slack_user_id`, `is_active` |
| `teams` | Org structure inside the workspace | `workspace_id`, `name`, `type`, `manager_user_id` |
| `integration_catalog` | Global registry of supported integrations | `name`, `category`, `auth_type`, `status`, `supports_webhooks`, `data_classes_json` |
| `workspace_integrations` | Customer's connected instance of an integration | `workspace_id`, `integration_catalog_id`, `auth_status`, `sync_status`, `last_successful_sync_at`, `last_error_message` |
| `sync_runs` | Per-sync execution log (for debugging stale data) | `workspace_integration_id`, `sync_type`, `started_at`, `status`, `records_created`, `cursor_after` |

**Tenancy note:** the existing build has implicit single-tenancy (cookie-backed workspace config). Adding `workspace_id` to every table from day one is cheap; the rewrite cost later is huge. Recommend yes — see Open Question §10.6.

### 2.2 `raw` namespace — original-payload archive

The audit trail. Every API response and webhook body is stored verbatim before normalization. Per spec §4.4. This is what makes the "evidence-first" principle (spec §9.4) provable — every signal can drill to the source object that produced it.

| Object | Purpose | Key fields |
|---|---|---|
| `raw_objects` | Original API payloads (one row per source object snapshot) | `workspace_id`, `source_system`, `source_object_type`, `source_object_id`, `raw_json`, `content_hash`, `source_updated_at`, `fetched_at` |
| `raw_events` | Webhook and event-stream bodies | `workspace_id`, `source_system`, `event_type`, `source_event_id`, `raw_json`, `received_at`, `processing_status` |
| `source_object_mappings` | Maps raw source objects to canonical Dugout objects | `source_system`, `source_object_id`, `canonical_object_type`, `canonical_object_id`, `mapping_method`, `confidence` |

The `raw` namespace overlaps with what this doc previously called "warm storage." Specifically: `raw_objects.raw_json` and `raw_events.raw_json` are the warm tier of the tiered storage model (§3 below). The tiered model is a deployment concern; the namespace model is a schema concern. They don't conflict.

### 2.3 `core` namespace — canonical GTM objects

The objects every feature reads from. Per spec §4.5. **This is where the spec expands what the workspace previously called 5 entities (Account, Person, Opportunity, Initiative, Asset) into ~25 objects.** Naming follows the spec — most notably, the workspace's `people` → spec's `contacts`.

| Object | Purpose | Key fields | Fed by |
|---|---|---|---|
| `accounts` | The buyer/customer company | `workspace_id`, `name`, `domain`, `industry`, `account_segment`, `lifecycle_stage`, `owner_user_id`, `crm_account_id` | Salesforce, HubSpot, ZoomInfo, Zendesk, Xero |
| `contacts` *(was `people`)* | Individual humans at buyer accounts | `workspace_id`, `primary_account_id`, `email`, `full_name`, `title`, `seniority`, `is_active` | Salesforce, HubSpot, ZoomInfo, Outreach, Zendesk |
| `opportunities` | Deal records | `workspace_id`, `account_id`, `stage_name`, `amount`, `close_date`, `owner_user_id`, `type` (new/expansion/renewal), `is_closed`, `is_won` | Salesforce |
| `opportunity_stage_history` | Audit of every stage transition | `opportunity_id`, `old_stage`, `new_stage`, `changed_at`, `changed_by_user_id` | Salesforce |
| `leads` | Pre-account/contact prospects (where CRM separates them) | `workspace_id`, `email`, `company_name`, `domain`, `lead_status`, `converted_account_id`, `converted_opportunity_id` | Salesforce, HubSpot |
| `meetings` | Calendar events with buyer participation | `workspace_id`, `account_id`, `opportunity_id`, `meeting_type`, `start_time`, `meeting_url`, `recording_url`, `status` | Chili Piper, Google Cal/Outlook, Gong |
| `meeting_attendees` | Per-meeting attendance log | `meeting_id`, `person_type`, `contact_id`, `attendance_status`, `joined_at`, `left_at` | Gong, Chili Piper, Granola |
| `transcripts` | Per-meeting full text | `meeting_id`, `source_system`, `transcript_text`, `language` | Gong, Granola |
| `transcript_segments` | Speaker-tagged segments (the unit fact-extraction reads from) | `transcript_id`, `speaker_email`, `speaker_type`, `start_seconds`, `text`, `confidence` | Gong, Granola |
| `messages` | Universal: email / Slack / Outreach / Salesloft / Intercom | `account_id`, `opportunity_id`, `thread_id`, `channel`, `direction`, `subject`, `body_text`, `sent_at`, `sender_contact_id` | Gmail/Outlook, Outreach, Slack, inbound email |
| `message_threads` | Conversation containers | `account_id`, `opportunity_id`, `source_thread_id`, `thread_type`, `subject`, `last_message_at`, `status` | Same as messages |
| `message_participants` | Per-message participant log (from / to / cc / mentioned) | `message_id`, `thread_id`, `participant_type`, `contact_id`, `email` | Same as messages |
| `activities` | Universal: CRM tasks, calls, sends, visits, views, stage changes | `account_id`, `opportunity_id`, `contact_id`, `activity_type`, `source_system`, `occurred_at`, `summary` | All tools |
| `activity_timeline` | Denormalized chronological spine (the universal feed) | `account_id`, `opportunity_id`, `event_type`, `event_time`, `event_title`, `importance_score`, `raw_object_id` | Derived from above |
| `assets` | Sales materials (decks, one-pagers, ROI calcs, security docs) | `workspace_id`, `name`, `asset_type`, `category` (finance/it/legal/...), `source_system`, `url` | Dock, Salesforce, manual upload |
| `asset_deliveries` | When an asset was sent to whom | `asset_id`, `account_id`, `opportunity_id`, `sent_to_contact_id`, `delivery_channel`, `sent_at` | Dock, Outreach, Gmail |
| `asset_engagements` | When a buyer touched an asset | `asset_id`, `asset_delivery_id`, `contact_id`, `engagement_type`, `engaged_at`, `duration_seconds` | Dock, Webflow |
| `deal_rooms` | Buyer-facing collaborative spaces | `account_id`, `opportunity_id`, `url`, `status`, `last_activity_at` | Dock |
| `deal_room_members` | Who has access to which deal room | `deal_room_id`, `contact_id`, `role` (owner/collaborator/viewer/buyer), `first_seen_at`, `last_seen_at` | Dock |
| `mutual_action_plan_items` | MAP tasks (the close-plan checklist) | `deal_room_id`, `opportunity_id`, `title`, `owner_type`, `due_date`, `status` | Dock |
| `tickets` | Support / CS tickets | `account_id`, `contact_id`, `opportunity_id`, `subject`, `status`, `priority`, `type`, `created_at`, `resolved_at` | Zendesk, Intercom |
| `billing_accounts` | Billing-side counterpart of `accounts` (often differs!) | `account_id`, `source_system`, `billing_email`, `currency`, `status` | Xero, Stripe |
| `invoices` | Invoice records (AR health) | `billing_account_id`, `account_id`, `invoice_number`, `amount_due`, `amount_paid`, `status`, `due_date`, `paid_at` | Xero, Stripe |
| `subscriptions` | Active recurring contracts | `billing_account_id`, `account_id`, `status`, `mrr`, `arr`, `current_period_end` | Xero, Stripe |
| `external_sources` | Configured news / RSS / SEC / newsletter feeds | `workspace_id`, `source_name`, `source_type`, `inbox_email`, `category`, `credibility_score`, `is_customer_provided` | NewsAPI, SEC EDGAR, inbound email |

**Naming change to absorb:** every existing reference to "person" / "people" in this codebase should migrate to `contact` / `contacts`. The spec is consistent; we'll match it. Same for the field rename `accounts.primary_domain` → `accounts.domain` (the spec uses the simpler form).

**Initiative is gone.** The old `initiatives` entity (pre-opportunity activity slot for shadow_research) is replaced by the spec's combination of `accounts.lifecycle_stage='target'` + `activity_timeline` rows + a `signal_instance` on the account. Cleaner; no extra table.

### 2.4 `graph` namespace — identity resolution + relationships

The hardest practical problem in the build, isolated to its own namespace. Per spec §4.6 + §9.3.

| Object | Purpose | Key fields |
|---|---|---|
| `entity_aliases` | Maps the same real-world account/contact across source systems | `canonical_entity_type`, `canonical_entity_id`, `source_system`, `source_object_id`, `source_email`, `source_domain`, `match_method`, `confidence` |
| `entity_match_candidates` | Uncertain matches awaiting human/AI review (never silent-merge low confidence) | `candidate_type`, `source_system`, `source_object_id`, `candidate_canonical_id`, `match_score`, `match_reasons_json`, `status` |
| `account_contacts` | Account ↔ contact relationship (with `is_current` for ex-employees) | `account_id`, `contact_id`, `relationship_type`, `is_current`, `confidence` |
| `opportunity_contacts` | Per-deal role assignment (the OCR-equivalent) | `opportunity_id`, `contact_id`, `role` (champion / economic_buyer / finance / it / legal / procurement / security / evaluator / end_user / executive_sponsor), `influence_level`, `engagement_level` |
| `account_users` | Internal team assigned to an account | `account_id`, `user_id`, `role` (owner/ae/sdr/csm/se/manager) |
| `opportunity_users` | Internal team on a deal | `opportunity_id`, `user_id`, `role` |
| `object_relationships` | Flexible graph edge for non-typed relationships | `from_object_type`, `from_object_id`, `to_object_type`, `to_object_id`, `relationship_type`, `confidence` |

**The `opportunity_contacts.role` enum is the field that drives `committee_gap` and `champion_*` rules.** This was previously living on `people.role` — now it lives on the join table, which is correct (the same contact can be a `champion` on one deal and an `evaluator` on a parallel expansion deal).

Role enum (per spec §4.6):
```
opportunity_contacts.role ∈ {
  champion, economic_buyer, finance, it, legal, procurement,
  security, evaluator, end_user, executive_sponsor, unknown
}
```

**The `assets.category` enum** is the cross-source comparable that previously lived in the workspace's `asset_class`. A Dock pricing PDF view and a Webflow pricing page view both reduce to `category = 'pricing'` for correlation purposes. Per spec §4.5:
```
assets.category ∈ {
  finance, it, legal, security, product, pricing,
  implementation, case_study
}
```
*Open question:* the spec's `category` enum is narrower than the previous workspace draft (which included `mutual_action_plan`, `sec_filing`, `newsletter_email`, etc.). MAP items now have their own table (`mutual_action_plan_items`); SEC filings live in `external_articles`. Net simplification.

### 2.5 `intel` namespace — signals, correlations, briefs, feedback

What Dugout produces. The spec defines: `extracted_facts`, `topic_mentions`, `signal_definitions`, `signal_dependencies`, `workspace_signal_configs`, `signal_instances`, `signal_evidence`, `recommendations`, `briefs`, `brief_sections`, `user_feedback` (per §5).

**The workspace extends this** with two opinionated additions that the spec leaves to the implementer: `signal_correlations` (multi-source corroboration as a first-class object, not just a higher-confidence signal) and `rules` (a rule registry that pairs to the 12-type taxonomy so RevOps can tune per-rule trust). These are what makes the cross-source story queryable.

See §4 below for the full schema of the workspace-specific extensions. The spec's standard `intel` objects map straightforwardly:
- `signal_definitions` = the 12 canonical signal types from §1 above, one row each
- `signal_instances` = one row per detection (what this doc previously called the `signals` table)
- `signal_evidence` = the linkage from signal back to `raw_objects` / `transcript_segments` / `messages` etc.
- `recommendations` = the "suggested next action" attached to each signal
- `briefs` / `brief_sections` = the rendered pre-meeting brief and digest outputs
- `user_feedback` = AE/manager response (helpful / not_helpful / noisy / action_taken) — feeds the per-rule trust score

---

## 3. Tiered storage — "include all information" without bankrupting the system

The schema above is the logical model. The physical layout uses **three storage tiers**. Every adapter writes to the appropriate tier; the AI layer reaches across all three.

The tiers map onto the spec's namespaces but aren't a 1:1 — tiered storage is a deployment concern (what kind of bucket, what indexes, what retention), namespacing is a schema concern (what does this object mean).

| Tier | What lives there | Storage | Latency | Retention |
|---|---|---|---|---|
| **Hot** | All `admin`, `core`, `graph` tables; `intel.signal_instances` + `signal_correlations`; rule registry | Supabase Postgres | <100ms | Forever |
| **Warm** | `raw_objects.raw_json`, `raw_events.raw_json`, derived JSONB payloads | Postgres JSONB or Supabase Storage (parquet daily roll-up) | 100–500ms | 90–365 days (configurable) |
| **Cold** | Full call transcripts, document extracted-text (MSA / pricing PDFs / security questionnaires), historical enrichment snapshots, raw audio/video pointers | Object storage (S3) | 1–5s | Forever |

### What writes where, by source

| Source | Hot | Warm | Cold |
|---|---|---|---|
| Salesforce | `accounts`, `opportunities`, `opportunity_stage_history`, `opportunity_contacts`; signals for stage/role/field changes | Full field-history JSONB in `raw_objects`; Platform Event payloads in `raw_events` | — |
| Gong | `meetings`, `meeting_attendees`, tracker-hit summaries, derived signals | Tracker hit details with timestamps and speaker IDs | `transcripts.transcript_text`, `transcript_segments` (S3); audio URL pointer only |
| Outreach | Sequence state in `activities`, message rows, derived signals | Raw mailing/reply webhook bodies in `raw_events` | — |
| Dock | `deal_rooms`, `deal_room_members`, `assets`, `asset_deliveries`, `asset_engagements` summaries, derived signals | Per-asset-per-user event log JSONB in `raw_events` | Asset content extracted text (MSA, pricing PDF) |
| HubSpot | `contacts`, `accounts` sync, lead form submissions, lifecycle changes | Raw webhook bodies, page-view history | — |
| ZoomInfo | `contacts`/`accounts` current state, latest job change, intent scores | Intent topic history JSONB | Daily enrichment snapshots (so we can show "what did we know about this account on May 1?") |
| Granola | `transcripts`, `transcript_segments`, `extracted_facts`, signals | Raw Granola API payloads | Full transcript fallback |
| Inbound email | `external_articles` metadata, classifier output, derived signals | Full email body in `inbound_emails.body` (already exists) | Long-term email archive (S3 after 365d) |
| NewsAPI / SEC | `external_articles` rows, classifier output, derived signals | Full article text in `raw_objects.raw_json` | — |
| Chili Piper, Nooks, Swyft, Zendesk, Xero, Webflow | Same pattern: summaries hot, raw payloads warm, large blobs cold | | |

### Why this works

1. **Every UX surface** runs against the hot tier — fast, cheap, predictable.
2. **The AI query layer** (§6) starts in hot, paginates into warm/cold only when the question demands it.
3. **Signal-logic rewrites** don't require re-ingestion — replay over the warm tier with new rules.
4. **Compliance** — cold-tier retention policies are tunable per data type (e.g., delete inbound email bodies after 365d if a customer's DPA requires it).

### Cost back-of-envelope

For one mid-market-scale customer (assume 500 active opps, 200 calls/week, 1k emails/week, 50 deal rooms with 200 weekly engagements):
- **Hot:** ~5M rows/year across all tables. Supabase Pro tier ($25/mo) handles this comfortably.
- **Warm:** ~50GB/year of JSONB. ~$1/GB/mo on Postgres = $50/mo, OR $0.023/GB/mo on S3 = $1.50/mo. Recommend S3 for warm beyond 30d.
- **Cold:** ~200GB/year of transcript + document text. $5/mo on S3.

**~$30–80/mo per customer for full-fidelity storage.** Negligible vs. the per-seat pricing of any tool in the stack.

---

## 4. The workspace `intel` extensions — schema

The spec's `signal_instances` is fine for single-source signals. The cross-source product needs `signal_correlations` as a first-class object and a `rules` registry that pairs to the 12-type taxonomy. These are the workspace's contribution. Postgres / Supabase.

### Signals (the spec's `signal_instances`, with workspace-specific columns)

```sql
create table signal_instances (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),

  -- provenance (workspace addition: source_event_id for idempotency)
  source_tool     text not null,                          -- 'salesforce' | 'gong' | 'dock' | ...
  source_event_id text,                                   -- idempotency key
  occurred_at     timestamptz not null,                   -- when it happened in reality
  detected_at     timestamptz not null default now(),     -- when Dugout saw it

  -- classification (the 12-type taxonomy)
  signal_definition_id uuid references signal_definitions(id),
  signal_type     text not null,                          -- champion_loss | committee_gap | ...
  severity        text not null,                          -- 'blocking' | 'action' | 'awareness'
  direction       text not null default 'negative',       -- 'negative' | 'positive' | 'neutral'
  -- NOTE: no per-signal `confidence` column. See "Design note: confidence" below for rationale.

  -- entity references (all nullable as appropriate)
  account_id      uuid not null references accounts(id),
  contact_id      uuid references contacts(id),           -- was person_id
  opportunity_id  uuid references opportunities(id),
  meeting_id      uuid references meetings(id),
  asset_id        uuid references assets(id),

  -- payloads
  raw             jsonb not null,                         -- original event from source
  derived         jsonb,                                  -- computed fields (latency_delta, days_in_stage, ...)

  -- orchestration
  rule_id         text references rules(id),
  status          text not null default 'open',           -- open | acknowledged | dismissed | resolved | expired
  suppressed_until timestamptz,                           -- debounce window

  created_at      timestamptz not null default now()
);

-- HOT-PATH INDEXES
create index si_account_time on signal_instances (workspace_id, account_id, occurred_at desc);
create index si_opp_severity on signal_instances (workspace_id, opportunity_id, severity, occurred_at desc);
create index si_type_account_time on signal_instances (workspace_id, signal_type, account_id, occurred_at desc);
create unique index si_idempotency on signal_instances (workspace_id, source_tool, source_event_id)
  where source_event_id is not null;
```

Evidence rows (per spec §5.3) link each signal back to the `raw_objects` / `transcript_segments` / `messages` row that produced it — that's the audit trail that powers the "why did Dugout flag this deal?" drilldown.

### Correlations: the moat made queryable

A *correlation* is an emergent record created when multiple signals of the same `signal_type` reinforce each other within a time window. Single-source signals are noisy; multi-source correlations are defensible. The spec doesn't define this object; the workspace treats it as first-class.

```sql
create table signal_correlations (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id),

  correlation_type text not null,                         -- same as signal_type: 'champion_loss', etc.
  account_id      uuid not null references accounts(id),
  opportunity_id  uuid references opportunities(id),
  contact_id      uuid references contacts(id),           -- e.g., the departing champion

  signal_ids      uuid[] not null,                        -- the corroborating signals
  source_tools    text[] not null,                        -- denormalized for fast query
  source_count    int generated always as (cardinality(source_tools)) stored,

  -- inherit direction from the underlying signals (all signals in a correlation share polarity).
  -- v1 only ACTS on direction='negative' correlations; positive correlations are stored but
  -- only consumed by manager-side forecast/coaching views. Removing this column later would
  -- require a backfill — present from day one to keep that door open.
  direction       text not null default 'negative',       -- 'negative' | 'positive' | 'neutral'

  derived_severity text not null,                         -- 'blocking' | 'action' | 'awareness'
  -- NOTE: no `confidence` column. The correlation's strength IS its `source_count`.
  -- 2 sources agreeing = elevated; 3+ = strong. Numeric confidence would just re-encode count.

  first_observed_at timestamptz not null,
  last_reinforced_at timestamptz not null,
  recommendation_id uuid references recommendations(id),  -- the action this drove

  -- Lifecycle (aligned with signal_instances.status enum for consistency)
  status          text not null default 'open',           -- 'open' | 'acknowledged' | 'dismissed' | 'resolved' | 'expired'
  resolved_at     timestamptz,
  resolution_reason text,                                 -- free-text or enum: 'champion_replied' | 'role_added' | 'manual' | 'rule_disabled' | 'auto_expired_after_30d' | etc.

  created_at      timestamptz not null default now()
);
create index sc_account_open on signal_correlations (workspace_id, account_id, status)
  where status = 'open';
create index sc_workspace_type_open on signal_correlations (workspace_id, correlation_type, last_reinforced_at desc)
  where status = 'open';
```

### Derived severity — the elevation rule

`derived_severity` is computed (not arbitrary). Rule:

```
derived_severity = max(severity across signal_ids)        -- floor: never softer than any contributing signal
elevate one tier if source_count >= 3                     -- 3+ tools agreeing promotes one tier
elevate to BLOCKING if any signal is BLOCKING            -- already covered by floor but explicit
cap at BLOCKING                                          -- no tier above BLOCKING
```

Worked example: a `champion_disengagement` correlation with 4 contributing signals — Outreach (ACTION) + Dock (ACTION) + Gong (AWARENESS) + Chili Piper (AWARENESS). Floor = ACTION (max of 4). Source count = 4 ≥ 3, so elevate one tier → **BLOCKING**. The correlation pages the AE even though no individual signal was urgent enough on its own.

### Materialization cadence — the design decision (not an open question)

Correlations are materialized by a cron job, not computed at query time. Different tiers run at different cadences:

| Tier | Cron cadence | Why |
|---|---|---|
| BLOCKING | **every 5 minutes** | AE-paging latency budget; <1hr per severity tier definition |
| ACTION | **hourly** | "today's task list" doesn't need sub-hour freshness |
| AWARENESS | **on-demand at query time** | Weekly digest reads correlations once; no point storing pre-computed |

12 signal types × 3 cadences = 36 scheduled queries total. Each query <100ms with the proper indexes (`si_type_account_time` on signal_instances, `sc_workspace_type_open` on signal_correlations). Negligible compute cost.

**Why not on-demand for everything:** every page load would run 12 correlation queries. Page latency goes from 100ms → 1-2s. Cron is the right call for BLOCKING + ACTION; on-demand is fine for AWARENESS because it's read rarely.

**Why not cron for everything:** AWARENESS correlations age out fast (we don't care about a 6-day-old "vertical context" signal once the rep has read it). Pre-materializing them wastes writes.

### Design note: why no per-signal `confidence`

Earlier drafts of this schema carried `confidence smallint (0–100)` on every `signal_instances` row, and again on every `signal_correlations` row. We've dropped both. Two reasons:

1. **It's not actually confidence — it's vibes.** With no customers and no outcome data, any numeric confidence per source tool is hardcoded ("Salesforce=95, Granola=70, NewsAPI=60") and never calibrated against acted-on vs. dismissed outcomes. That's a knob that pretends to be data.

2. **It dilutes the "single query across the schema" goal.** Source-tool *agreement* is already the confidence signal — if 3 tools independently observe the same `signal_type` on the same account in 14 days, that's structurally stronger than 1 tool reporting it with self-assigned confidence=95. The schema already expresses this via `count(distinct source_tool)` in correlation queries. Adding a confidence column just re-encodes the count badly.

**When confidence earns its way back:** once we have ≥90 days of "AE clicked Acted-On vs Dismissed" data per rule, the `rules.acted_on_count / rules.hit_count` ratio becomes the real, *learned* confidence signal — and it lives at the rule level, not the signal level. Per-instance confidence isn't useful at any stage.

**What we kept:** `confidence` columns on `graph` namespace tables (`entity_aliases.confidence`, `entity_match_candidates.match_score`, `account_contacts.confidence`, `object_relationships.confidence`) and on `transcript_segments.confidence` (ASR confidence from Gong/Granola). Those are real numbers from real sources — identity-match scores have concrete probabilistic meaning, and ASR confidence comes from the provider. The `intel`-namespace per-signal confidence was the only made-up one, and it's gone.

### Rules: data, not code

The 13 rules currently in `signal-engine.ts` (plus the 42 implied by the dictionaries) get registered in a table so the dictionary and the engine stay in sync. This is the workspace-specific operationalization of the spec's `signal_definitions`.

```sql
create table rules (
  id              text primary key,                       -- 'champion_reply_latency_decay'
  signal_definition_id uuid references signal_definitions(id),
  source_tool     text not null,                          -- which adapter feeds it
  signal_type     text not null,                          -- canonical taxonomy
  base_severity   text not null,
  description     text,
  predicate_pseudocode text,                              -- copied from dictionary's "Rule shape"

  active          boolean not null default true,
  hit_count       int not null default 0,
  acted_on_count  int not null default 0,                 -- AE actually did the suggested action
  false_positive_count int not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

`acted_on_count / hit_count` is the per-rule trust score. This is what RevOps tunes after each quarter to retire noisy rules and promote precise ones — and it's what makes the system *learnable* without ML.

---

## 5. Mapping our ontology to the spec's modules

Spec §2.3 lists 14 product modules. Each is a feature; each requires a specific subset of canonical objects to be populated. **A module is "unlocked" when its required objects all have data flowing in.** This is what the onboarding flow (spec §3.4) computes.

For each module, the 3–5 required `core` + `graph` + `intel` objects. The "anchor signal_type(s)" column shows which of the 12 types fire inside the module.

| Module | Required canonical objects | Anchor signal_type(s) |
|---|---|---|
| **Meeting Readiness Brief** | `meetings`, `meeting_attendees`, `activity_timeline`, `opportunity_contacts`, `briefs` | `account_context`, `momentum_change` |
| **Budget Approval Risk** | `opportunities` (stage), `opportunity_contacts` (finance role), `extracted_facts` (budget mentions), `asset_deliveries` (CFO package), `asset_engagements` | `committee_gap`, `momentum_change` |
| **Finance/IT Engagement Sequencing** | `opportunities`, `opportunity_contacts` (finance + it roles), `transcript_segments`, `meeting_attendees`, `messages` | `committee_gap`, `committee_expansion` |
| **Trial/POC Execution SLA** | `opportunities` (stage transition), `opportunity_stage_history`, `activities` (AE intake, SE handoff), `assets` (KPI assessment), `asset_deliveries` | `data_hygiene_gap`, `momentum_change` |
| **Deal Execution Consistency** | `opportunities`, `opportunity_stage_history`, `mutual_action_plan_items`, `activities`, `messages` | `momentum_change`, `data_hygiene_gap` |
| **Stakeholder Map Gaps** | `opportunities` (amount, stage), `opportunity_contacts` (role coverage), `meeting_attendees`, `messages` (participants), `extracted_facts` (untracked-person mentions) | `committee_gap`, `committee_expansion` |
| **Champion Risk** | `opportunity_contacts` (champion role), `meeting_attendees` (attendance), `messages` (reply latency), `asset_engagements` (deal-room visits), `entity_aliases` (job-change enrichment) | `champion_loss`, `champion_disengagement` |
| **Competitive Risk** | `transcript_segments`, `extracted_facts` (competitor_mention), `messages`, `opportunities` (competitor field), `external_articles` | `competitive_threat` |
| **ABM Account Intelligence** | `accounts` (target-list), `activity_timeline`, `external_articles`, `account_external_matches`, `asset_engagements` (anonymous viewers) | `shadow_research`, `account_context` |
| **External Market Context Inbox** | `external_sources`, `external_articles`, `external_entities`, `external_topics`, `account_external_matches` | `account_context`, `vertical_context` |
| **Manager Pipeline Risk Digest** | `opportunities` (open + late-stage), `signal_instances`, `signal_correlations`, `briefs` (manager_digest type), `recommendations` | All blocking-tier types |
| **CRM Hygiene and Auto-Capture** | `opportunities`, `opportunity_contacts`, `meetings`, `extracted_facts`, `activities` | `data_hygiene_gap` |
| **Expansion/CS Risk** | `subscriptions`, `tickets`, `accounts` (customer lifecycle_stage), `asset_engagements`, `messages` | `account_health_decline`, `lifecycle_milestone` |
| **Billing/Payment Risk** | `billing_accounts`, `invoices` (overdue), `subscriptions` (past_due / canceled), `accounts`, `tickets` | `account_health_decline`, `lifecycle_milestone` |

**Onboarding implication:** when a customer connects integrations during onboarding (spec §3.3), the system can compute *exactly* which modules light up and which are blocked on missing connections. "Connect Dock to unlock Deal Room Engagement; connect Xero to unlock Billing/Payment Risk." That's the spec §3.4 Unlocked Intelligence Calculation, grounded in this mapping.

---

## 6. Correlation queries: the product made executable

Two worked examples. Both are real Postgres queries that would run as scheduled jobs or live triggers. (Both shown against the renamed schema — `signal_instances` + `contacts`.)

### Example A — `champion_loss` correlation across 4 sources

```sql
-- Find accounts where 2+ different tools reported champion_loss in last 14 days
-- and there's an open Selected Vendor (or later) opportunity.

with recent as (
  select
    s.account_id,
    s.contact_id,
    s.id as signal_id,
    s.source_tool,
    s.occurred_at
  from signal_instances s
  where s.signal_type = 'champion_loss'
    and s.occurred_at > now() - interval '14 days'
),
correlated as (
  select
    account_id,
    contact_id,
    array_agg(signal_id) as signal_ids,
    array_agg(distinct source_tool) as source_tools,
    count(distinct source_tool) as source_count,
    max(occurred_at) as last_reinforced_at,
    min(occurred_at) as first_observed_at
  from recent
  group by account_id, contact_id
  having count(distinct source_tool) >= 2
)
select
  c.*,
  o.id as opportunity_id,
  o.stage_name,
  o.amount,
  o.owner_user_id
from correlated c
join opportunities o
  on o.account_id = c.account_id
  and o.is_closed = false
  and o.stage_name in ('Selected Vendor', 'Negotiation', 'Verbal')
order by source_count desc, last_reinforced_at desc;
```

**What this produces:** the BLOCKING task list for "champion just left at a late-stage account" — with the *evidence trail* attached (which 2+ tools reported it, when). The rep clicks the task, sees: "ZoomInfo detected job change 11 days ago. Outreach saw hard bounce 6 days ago. Nooks logged 2 'no longer at company' dispositions in the last week." That's a defensible alert.

### Example B — `committee_gap` correlation on Selected Vendor opps

```sql
-- For each open Selected Vendor opp, count distinct sources reporting committee_gap.
-- 2+ sources = BLOCKING auto-create task.

with opp_signals as (
  select
    s.opportunity_id,
    s.account_id,
    array_agg(distinct s.source_tool) as gap_sources,
    count(distinct s.source_tool) as source_count,
    max(s.occurred_at) as last_signal_at,
    array_agg(s.id) as signal_ids
  from signal_instances s
  join opportunities o on o.id = s.opportunity_id
  where s.signal_type = 'committee_gap'
    and o.is_closed = false
    and o.stage_name = 'Selected Vendor'
    and s.occurred_at > now() - interval '21 days'
  group by s.opportunity_id, s.account_id
)
select
  os.*,
  o.amount,
  o.owner_user_id,
  -- corroborating context: which committee roles ARE present?
  array(
    select distinct oc.role
    from opportunity_contacts oc
    where oc.opportunity_id = os.opportunity_id
  ) as present_roles
from opp_signals os
join opportunities o on o.id = os.opportunity_id
where source_count >= 2
order by source_count desc, last_signal_at desc;
```

**What this produces:** a BLOCKING list of "Selected Vendor opps where Salesforce *and* Dock *and* Gong all independently report no Finance/IT/Legal engagement." That's not "one rule fired" — that's "three independent systems agree, and here's exactly which committee roles you're missing."

---

## 7. The AI query layer — "ask questions across integrations"

The schema + tiered storage make this layer cheap and obvious. Architecture: a **tool-use agent** given a small set of typed query tools over the unified store. User asks a natural-language question; the agent picks tools, retrieves grounded data, synthesizes an answer with citations.

**Model provider: user-chosen per question, OpenAI OR Anthropic.** Three model options ship today: **GPT-4o** (OpenAI), **Claude Sonnet 4.6** (Anthropic), **Claude Haiku 4.5** (Anthropic cheap). The user picks in a dropdown above the input on `/ask` (and inside the drawer chat panel). Choice is persisted to localStorage (`DUGOUT_ASK_CHOICE`); options whose API key isn't configured in env are greyed out with a "key missing" hint.

**Token model: server-side only.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` live in env vars on the Dugout server — never exposed to the client, never stored per-workspace in Vault. Dugout pays the bill; the user picks the model. The other AI surfaces (morning digest on Sonnet 4.6, inbound-email classifier on Haiku 4.5) stay model-specific by design — they're single-shot prompts with stable cost where provider choice doesn't earn its keep.

**Architecture (shipped — see commit `8c8c74e` on `claude/agentmail-rotation`):**

```
src/lib/ask-system-prompt.ts   — single prompt, both providers. Enumerates
                                 12 canonical signal_types, 3 severity tiers,
                                 3 direction values, 8 tools with "when to
                                 pick" cues, citation requirement, voice,
                                 read-only boundaries.

src/lib/openai.ts              — OpenAI client wrapper (HAS_OPENAI_KEY,
                                 getOpenAIClient).
src/lib/anthropic-ask.ts       — Anthropic client wrapper (HAS_ANTHROPIC_KEY,
                                 getAnthropicClient). Sibling pattern.

src/lib/ask-tools.ts           — ASK_TOOL_SCHEMAS_OPENAI + 
                                 ASK_TOOL_SCHEMAS_ANTHROPIC, both derived from
                                 the same source so they cannot drift. 8 tool
                                 TypeScript implementations are provider-blind.

src/lib/ask-agent.ts           — runAskAgent({question, accountSlug, provider,
                                 model}). Provider-agnostic. Max 8 tool calls
                                 per turn, max 4 turns. On provider 5xx,
                                 falls back to stub with stubReason set
                                 (different from at-cap, which is a hard stop).

src/lib/ask-rate-limit.ts      — Per-session caps: 20/hr, 100/day; global
                                 500/day kill switch. Backed by Supabase
                                 ask_request_log table. Row written only on
                                 allow path so denied requests don't inflate
                                 the count. Fails open on Supabase outage
                                 (warning logged) — intentional v1 trade-off
                                 for demo continuity.

src/app/api/ask/route.ts       — POST. Reads {question, accountSlug, provider,
                                 model}. Mints/reads dugout-ask-session
                                 HttpOnly cookie (separate from the shared
                                 UI_SESSION which is HMAC of a constant).
                                 checkAndRecordAskRequest BEFORE runAskAgent.
                                 At cap: 429 + Retry-After header +
                                 retry_after_seconds in body. No stub fallback
                                 at cap.

src/app/api/ask/providers/route.ts — GET. Returns {openai: bool, anthropic:
                                     bool} env-key presence. Never returns
                                     the keys themselves. Gated by
                                     requireUiSession().

src/components/ask-provider-picker.tsx — useAskChoice() + <AskProviderPicker>.
                                         Single source of truth used by both
                                         /ask and the drawer chat panel.
```

The query-tool interface is provider-agnostic — same 8 functions, two schema serializations (OpenAI's `tools[].function.parameters` vs Anthropic's `tools[].input_schema`). The TypeScript implementations are identical. Adding a new tool means adding it once; both providers learn it for free.

### The tool set (~8 functions)

```typescript
// All tools return typed, citable results with source signal_instance_ids
// so the agent's answer can link back to specific evidence.

tools = [
  // Account-level context
  get_account_context(account_slug, days=90): {
    accounts row, open opportunities, key contacts by role, recent correlations
  },

  // Time-ordered cross-source event stream
  get_account_timeline(account_slug, days=30, source_filter?): TimelineEvent[]
    // reads from activity_timeline + signal_instances + correlations

  // Search by signal_type
  find_signals(signal_type, scope: {account|owner|team}, days): SignalInstance[]

  // Cross-source correlation lookup
  get_correlations(scope, types[], days, min_sources=2): Correlation[]

  // Call/transcript retrieval (reaches into cold store)
  get_calls(opportunity_id, limit=5): {meeting, transcript_excerpt, recording_url}

  // Message thread retrieval (warm store)
  get_messages(account_id, contact_id?, channel?, days=30): Message[]

  // Document engagement
  get_committee_engagement(opportunity_id): {
    present_roles[], missing_roles[], per_asset_views, last_visit_per_contact
  },

  // Aggregations for manager-level questions
  rollup(metric, dimension: {rep|stage|segment|competitor}, window): {...}
]
```

### Worked example — "Why is the Helios deal stalling?"

```
User: Why is the Helios deal stalling?

Agent calls get_account_context("acc_helios", 90):
  → Helios Manufacturing, stage=Selected Vendor (23d), $185K, owner=sarah@example.com
  → Champion: Maria Chen (VP Eng), EB: Tom Wright (CFO)
  → 1 active correlation: champion_disengagement, 3 sources agreeing

Agent calls get_account_timeline("acc_helios", 30):
  → 14 events. Notable:
     - 14d ago: Maria last visited Dock room (was visiting 2-3x/week prior)
     - 12d ago: Outreach reply latency on Maria went 8h → 9d
     - 9d ago: Gong call with Maria, no next step committed
     - 7d ago: Unknown viewer "sarah.k@helios.com" opened pricing PDF
     - 3d ago: ZoomInfo Scoop: Helios announced Q2 headcount freeze

Agent calls get_committee_engagement(opp_id):
  → CFO (Tom Wright): zero views of pricing or order form
  → Legal (Janet Liu): MSA opened once 11d ago, no return

Agent synthesizes:

  "The Helios deal is showing classic late-stage stall. Three correlated signals:

   1. Your champion (Maria Chen) went quiet 14 days ago. She was visiting the deal
      room 2-3x/week before, hasn't been back since. Her email reply latency also
      went from 8h to 9d in the same window. Last call with her ended without a
      committed next step.

   2. The economic buyer (Tom Wright, CFO) has never opened the pricing PDF or
      order form. He's not engaged.

   3. Helios announced a Q2 headcount freeze 3 days ago — likely budget-tightening
      driving Maria's silence and Tom's non-engagement.

   One positive signal: an unknown viewer (sarah.k@helios.com) opened pricing 7
   days ago. Might be procurement getting involved — worth identifying.

   Suggested next move: don't push Maria. Reach out to Tom directly with a
   freeze-aware re-anchor ('we hear you're tightening Q2 — here's a 6-month deferred
   start option'). And identify Sarah K. before next call."

Citations: [signal_instance_id_1, signal_instance_id_2, ...] each clickable to source.
```

### Two surfaces

| Surface | Audience | Pattern |
|---|---|---|
| **`/ask` route** | Both AE and Manager | Full chat thread, conversational follow-ups, exportable. The "deep work" surface. |
| **Drawer chat panel** | AE on a specific account | Pre-scoped to the open account; first question prefilled ("brief me on this account"). The "in-flow" surface. |

### Cost model

- Per question (any provider): ~$0.02-0.10 depending on how many tools the agent uses. GPT-4o and Claude Sonnet 4.6 are at price parity for tool-use workloads. Haiku 4.5 ≈ $0.005/question for users who prefer cheap-and-fast.
- **Hard cap to protect the budget:** 20 questions/hour and 100 questions/day per session; 500 questions/day global. At cap: 429 with `retry_after_seconds`. No stub fallback — hard stop. Backed by `ask_request_log` table; counts are per-session via the `dugout-ask-session` HttpOnly cookie.
- **Prompt caching** on hot accounts: cache the account_context + recent timeline; subsequent questions on same account drop to <$0.01
- At 9 AEs × ~5 questions/day = ~45 questions/day → ~$1-5/day per mid-market-scale customer

### What this DOES NOT do

- **No writes to source systems.** This layer is read-only intelligence. Updating Salesforce, sending emails, etc. is out of scope. Earn the write later.
- **No prediction without evidence.** The agent only states what the signals show. "The deal is at risk because X, Y, Z" — never "the deal will close at 70% probability" without a calibrated model behind it.
- **No cross-customer learning.** Each org's data stays in their tenant. No "Dugout learned from 500 other deals that this pattern predicts loss."

---

## 8. Identity resolution — the hardest practical problem

Every signal in this model assumes we can answer: *given an email, a domain, a company name, a ZoomInfo personId, a Salesforce Contact.Id — is this the same human/account?*

This is the single hardest engineering problem in the build. Without solving it, every cross-source correlation misfires. The spec dedicates §9.3 to this; the priority order below is theirs, the failure modes are ours.

### Account resolution

Spec priority order (§9.3): direct CRM association → exact email match → exact domain match → source-provided CRM ID → calendar attendee email → transcript participant → deal-room member → fuzzy company+domain → fuzzy name+company → AI/manual.

| Input | Resolution path | Failure mode |
|---|---|---|
| `domain` (`helios.com`) | Lookup `entity_aliases` by `source_domain`, fall back to `accounts.domain` | Subsidiaries, parent companies, multi-domain orgs |
| `crm_account_id` (Salesforce) | Direct join on `accounts.crm_account_id` | None if SFDC is system of record |
| HubSpot Company ID | Via `entity_aliases.source_system='hubspot'` | Orphan HubSpot Companies, manual merge required |
| `zoominfo_company_id` | Via `entity_aliases`; built on first enrichment | ZI companyId changes on M&A |
| Xero contact (billing) | Via `billing_accounts.account_id`; billing entity ("Helios Corp - AP") often ≠ sales account | Fuzzy match + override table |

**Strategy:** the `accounts` table is the canonical record. Every adapter's first job on a new payload is to call `resolveAccount(payload)` which returns an `account_id` or creates a new one + an `entity_aliases` row. Single point of identity logic; testable in isolation. **Low-confidence matches go to `entity_match_candidates` for review — never silent-merge** (spec §9.3).

### Contact resolution

| Input | Resolution path | Failure mode |
|---|---|---|
| `email` | Lookup `entity_aliases` scoped to account, fall back to `contacts.email` | Personal Gmail addresses for procurement/legal |
| Salesforce Contact ID | Direct via `entity_aliases` | None |
| ZoomInfo personId | Direct join — *but ZI's personId stability across job changes is an open question* | If unstable, must fall back to email+name fuzzy |
| Title → role classification | Heuristic `classifyRole(title)` → `opportunity_contacts.role` | False positives on non-standard titles (e.g., "Director of Special Projects") |

### What we do NOT try to solve

- **Cross-account contact tracking** (champion moves from Helios to Atlas) — we *do* want to detect this (it's `champion_loss` at Helios + `committee_expansion` at Atlas) but we don't try to unify the personId across the move. ZoomInfo does that for us via their people graph.
- **Anonymous → identified stitching for website visitors** — that's the de-anon vendor's job (HubSpot, Clearbit Reveal). We consume identified events only.

---

## 9. Migration from current state

Dugout today has:
- `external_signals` table (NewsAPI + SEC + inbound email writes here)
- `inbound_emails` table (raw email storage before classification)
- In-memory accounts (seed.ts, 11 public-co fixtures)
- Cookie-backed workspace config
- localStorage-backed tasks

**Migration path** (no big-bang rewrite):

1. **Create the `admin` + `core` + `graph` tables alongside `external_signals`.** No deletes. Both run in parallel.
2. **Backfill `accounts` + `contacts` from `seed.ts`.** ~11 accounts, ~30 contacts. One-time script. Generate `entity_aliases` rows for each existing identifier.
3. **Rewrite the 3 live adapters (NewsAPI, SEC, inbound email) to dual-write** — into the new `signal_instances` + `external_articles` *and* the old `external_signals`. Two weeks of dual-write to verify parity.
4. **Add the 12 new tool adapters** writing only to the new `signal_instances` table. Each one starts with one signal (the Tier-S signal per the dictionary) and grows.
5. **Re-point `signal-engine.ts`** at the new table. Keep the existing 13 rules; add the dictionary-derived rules as they're built. Migrate `person_id` references to `contact_id`.
6. **Add `signal_correlations` job** — runs every 5 min, materializes the cross-tool patterns.
7. **Migrate tasks to Supabase** as `recommendations` (already on the roadmap as Strategic Rec #3 in the handoff).
8. **Retire `external_signals` table** once parity is proven.

Estimated migration effort: **~2 weeks single-engineer** for steps 1–4. Steps 5–8 are incremental.

---

## 10. What this unlocks — every correlation is a product

The reason this synthesis is non-skippable: **every `signal_type` correlation that fires across 2+ sources is a defensible product feature.** Each one is a section of a website. Each one is a slide in the demo. Each one is a `module` in spec §2.3.

| Product feature | What fires it | Why it's defensible |
|---|---|---|
| **Multi-source Champion Departure Detection** | `champion_loss` correlation ≥2 sources | UserGems sees ZoomInfo only. We see 4 sources — and we explain which 2+ agreed. |
| **Buying Committee Health Score** | `committee_gap` correlation across SFDC + Dock + Gong + Swyft | Per-opp 0–100 score with the missing roles named. No one else combines deal-room + call-attendance + CRM-structure. |
| **Deal Stall Early Warning** | `champion_disengagement` correlation across Dock + Outreach + Gong + HubSpot + Chili Piper | 5 sources. Source-count IS the strength signal. The "your champion is going dark" alert with receipts. |
| **Competitive Threat Radar** | `competitive_threat` correlation, with Gong-verified verbal mention as highest weight | Distinguishes "buyer said it on a call" from "buyer's coworker viewed a comparison page" — and weights accordingly. |
| **Cold-Account Activation** | `shadow_research` correlation on accounts with `lifecycle_stage='target'` | Intent surge + WebSights visit + form fill from same account = the SDR's pre-warmed lead. |
| **Expansion-Deal Red Flag** | `account_health_decline` correlation across Zendesk + Xero on active expansion opps | "Don't pitch the upsell — they have 3 open P1s and AR is 60 days overdue." |
| **Reference Customer Watchlist** | `account_health_decline` on accounts tagged `reference_status=active` | Stop using a now-unhappy customer on reference calls before the AE finds out the hard way. |
| **Renewal Quarterback** | `lifecycle_milestone` (renewal_window) + 90d signal history per account | Auto-briefs the AE with what happened over the year, who engaged when, what risks accumulated. |
| **MEDDPICC Completeness Score** | `data_hygiene_gap` correlation per opp *(future — awaits Swyft wiring)* | RevOps dashboard: which AEs have the cleanest deal hygiene, where Swyft is failing to extract. |
| **Pre-meeting Intel Brief** *(powered by `account_context` + `vertical_context`)* | Account news + vertical trends in last 30d auto-rendered 15 min before any external calendar event | The "no cold meetings" product principle made literal. NewsAPI + SEC + newsletter inbox are already producing the signals; just need to render them per-meeting. |
| **Newsletter Intelligence (already shipping)** | Inbound email classifier → `shadow_research` or `competitive_threat` signals attached to accounts | The "subscribe Dugout to your buyer's reading list" feature. No competitor has this. |

**10 products. One schema.** Adding tool #13 doesn't require new product surface — it slots into existing signal_types and the existing 10 products get more accurate.

---

## 11. How this schema powers the case-derived metrics

The schema is the substrate; the metrics it produces are what the interview panel cares about. Full formula in [metrics.md](metrics.md). Here's the schema→metric chain for the hero metric (**Selected Vendor Health Score**):

```
Source webhook  →  signal_instances row  →  signal_correlations row  →  component score  →  SV Health Score
─────────────      ─────────────────────    ───────────────────────    ──────────────       ────────────────
Dock asset       Dock relay                  committee_gap              Buying-committee     Weighted sum,
view event   →   write with             →    (3 sources agree:       →  coverage = 40    →   0–100 per opp
(Salesforce      signal_type=                 SFDC OCR + Dock           (×0.30 weight)
managed pkg)     committee_gap                silence + Gong call
                 + source_event_id            attendance)
                 (idempotency)
```

Every component score in the SV Health formula has this same shape:

| Component | Weight | Reads from | Powered by signal_type(s) |
|---|---|---|---|
| Time-in-stage | 20% | `opportunities` joined to `opportunity_stage_history` | Salesforce stage change |
| Committee coverage | 30% | `signal_instances` joined to `opportunity_contacts` by role | `committee_gap`, `committee_expansion` |
| Enablement deployment | 20% | `asset_engagements` filtered to `assets.category IN (finance, it, legal, security)` | `shadow_research` (asset views by external viewers) |
| Champion engagement | 20% | `signal_instances` filtered to `contact_id = primary champion` | `champion_disengagement` |
| Risk penalty | -10% to 0 | Active `signal_correlations` on the opp | All BLOCKING-tier correlations |

**Traceability:** any score on the dashboard can be drilled to: component score → signals that fed it (with `source_event_id`) → `signal_evidence` row → `raw_objects` payload at `occurred_at` → click into source system. This is what makes the system defensible when an AE asks "why did Dugout flag this deal?"

The schema was designed for this from day one — no retrofit needed.

---

## 12. Open design questions

These are the calls Jackson needs to make (or get RevOps input on) before code:

1. **Asset category taxonomy** — the spec's `assets.category` enum is narrower than the previous workspace draft. Edge cases: do invoice PDFs warrant a category, or live as `assets.asset_type='pdf'` without category? Does newsletter content even land in `assets`, or only in `external_articles`? Editing this enum after launch is expensive.

2. **When (if ever) to re-introduce per-rule learned confidence.** The schema dropped per-signal confidence because we have no customers and no calibration data. The natural successor is `rules.acted_on_count / rules.hit_count` — but that requires ≥90 days of outcome data. Open: do we add a `rules.learned_trust` materialized column at that point, or compute live? And: do we ever surface trust to the rep, or keep it RevOps-internal?

3. ~~`signal_correlations` materialization cadence~~ — **Decided.** BLOCKING = 5min cron, ACTION = hourly cron, AWARENESS = on-demand at query time. See "Materialization cadence" section above for rationale.

4. **Auto-resolution rules** — when does a correlation auto-close? E.g., `champion_loss` correlation should auto-resolve when a new `opportunity_contacts` row with `role='champion'` is added. Without this, the task list becomes a graveyard.

5. **Target → opportunity promotion** — what makes an `account` with `lifecycle_stage='target'` (cold-account shadow research) graduate to `lifecycle_stage='open_opportunity'` + an actual `opportunities` row? Manual SDR action? Auto-promote on 3rd `shadow_research` signal? Product decision, not engineering.

6. **Multi-tenancy** — does the schema have a `workspace_id` on every table from day one (yes), or do we defer until the second customer (no)? Recommend yes; the cost is zero today and the rewrite cost later is huge. The spec assumes yes throughout.

7. **`activity_timeline` materialization** — spec §4.5 says "may be a denormalized event table derived from objects above." That's a deferred call. Recommend: start by reading directly from `activities` + `signal_instances` + `opportunity_stage_history` via a view; materialize only when query latency demands it.

---

## 13. The one-paragraph version

Every signal across every tool — internal CRM/marketing/sales/CS systems *and* live-world feeds like email, news, and SEC — fits the spec's 5-namespace ontology (`admin` / `raw` / `core` / `graph` / `intel`), classifies into 12 workspace-defined `signal_type` values, and cross-source correlation is a SQL query: "give me accounts where 2+ tools reported the same signal_type in the last N days." Each correlation lights up one of the spec's 14 product modules with a defensible evidence trail. The hard problem is identity resolution (one contact across 13 tools, governed by `entity_aliases` + `entity_match_candidates`); everything else is plumbing. Migration from current state is 2 weeks of dual-write parallel to the existing `external_signals` table — no big-bang rewrite. The spec is the blueprint; this doc is the workspace-specific operating system.

---

## See also

- **[Dugout Product Spec v0.1](../../../dugout_product_spec_v_0_1.md)** — the general-purpose blueprint this doc instantiates
- [dictionary.md](dictionary.md) — the 13-tool index this synthesis is built on
- [metrics.md](metrics.md) — the Selected Vendor Health Score formula and case-derived metrics
- [discovery/ae-workflow.md](discovery/ae-workflow.md), [discovery/manager-workflow.md](discovery/manager-workflow.md), [discovery/information-requirements.md](discovery/information-requirements.md)
- `tools/*.md` — per-tool signal cards with raw API surface, rule shapes, effort estimates
- `src/lib/signal-engine.ts` — current 13-rule engine (the migration target)
- `supabase/migrations/` — where the actual schema lands when this ships
