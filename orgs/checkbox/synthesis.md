# Synthesis — The Unified Signal Model

> The relational backbone. Every signal from every source — internal SaaS or live-world — fits one shape. That shape is the product.
> **For what this schema actually MEASURES — the Selected Vendor Health Score formula and the case-derived metrics it powers — see [metrics.md](metrics.md)** *(backstop, not the lead demo pitch)*.

## The thesis

**Dugout's product is anti-cold-meetings** — a centralized intelligence layer so no AE walks into a buyer conversation under-informed. The Selected Vendor wedge is the demo anchor; the schema below is what makes the broader product possible.

The 13 per-tool dictionaries describe **49 distinct signals across 13 internal operating systems** (12 from the Checkbox case + Granola, which is actually built), plus 3 live-world adapters already in production (NewsAPI, SEC EDGAR, inbound email). Without synthesis they're 46+ dashboards. With synthesis they're a single queryable model where any signal can corroborate any other, any new source plugs into the same shape, and any cross-source correlation becomes a defensible product feature.

This document defines:
1. The **canonical signal taxonomy** (10 signal types every source-signal maps to)
2. The **ontology entities** (5 things signals attach to)
3. The **relational schema** (Postgres / Supabase tables)
4. The **correlation queries** that turn raw signals into compounded confidence
5. The **identity resolution** problem — the hardest practical work
6. The **migration story** from Dugout's current state
7. The **products** this unlocks

If `dictionary.md` is the input catalog, **this is the operating system**.

---

## 1. The canonical signal taxonomy

All 49 source-signals collapse into **12 canonical signal types**. The signal_type is the abstraction that makes cross-source correlation possible — different tools observing the same underlying phenomenon get the same `signal_type`, even though their raw payloads differ. Polarity (good news vs bad news) is carried on the `direction` field of each signal, not in the type name — so `momentum_change` with `direction='positive'` is "next step committed" and `direction='negative'` is "stage stagnated."

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
| **`account_context`** *(new)* | **External world reporting about a specific account — anything in the news layer that the AE should know before walking in** | **NewsAPI (live), SEC EDGAR (live), inbound email when classified to a specific account** | **AWARENESS → ACTION** |
| **`vertical_context`** *(new)* | **Industry-level intel — trends, regulations, competitor moves at the category level, not tied to one account. Powers the "vertical their clients live in" framing.** | **Inbound newsletter inbox (live), market intel pipeline (live)** | **AWARENESS** |
| `data_hygiene_gap` *(future-state)* | Structured deal metadata is missing or stale — rules can't fire reliably. **No live adapter produces this yet; defined for when Swyft is wired.** | Swyft (MEDDPICC field staleness), Salesforce (missing contact roles) | BLOCKING for rule viability |

**Why this matters:** when 3 different tools observe `champion_loss` on the same account in 14 days, that's not 3 alerts — it's *one event* with high confidence. The signal_type is the join key.

**Why 12, not 10:** earlier drafts had 10. The two adds (`account_context`, `vertical_context`) cover the *live* live-world feeds — NewsAPI, SEC, inbound newsletter — that already ship today but didn't have a home in the deal-focused taxonomy. The `momentum_change` rename absorbs the awkward "positive momentum_stall" case (next step committed, champion signaled strength) by leaning on the existing `direction` field rather than fighting it with naming.

---

## 2. The ontology entities

Signals attach to 5 entities. Most signals reference 2–4 of them.

| Entity | What it is | Identity sources |
|---|---|---|
| `accounts` | The buyer company | Salesforce Account, HubSpot Company, ZoomInfo Company, Zendesk Organization, Xero Contact (billing) — all unified via domain + manual override |
| `people` | Humans tied to an account, with a role classification | Salesforce Contact, HubSpot Contact, ZoomInfo Person, Outreach Prospect, Zendesk User — unified via email + ZoomInfo personId where stable |
| `opportunities` | The deal-cycle instance (SFDC opportunity) | Salesforce Opportunity (system of record) |
| `initiatives` | A buyer activity not yet tied to an opportunity (intent surge, anonymous research, cold-account engagement) — pre-opportunity ontology slot | Synthetic, created when shadow_research fires on an account with no open opp |
| `assets` | The thing the buyer touched (doc, page, form, meeting, invoice, email, call) | Per-source IDs, classified into asset_class for cross-source comparison |

Person role classification (the field that drives committee_gap and champion_* rules):

```
person.role ∈ {
  champion,           -- internal advocate, IsPrimary=true on OCR
  economic_buyer,     -- has budget authority (CFO, VP, owner-level)
  finance,            -- AP, finance ops, controller
  legal,              -- GC, legal ops, outside counsel coordinator
  it_security,        -- CIO, IT director, security review
  procurement,        -- vendor management, sourcing
  detractor,          -- known opposition
  influencer,         -- peer of champion, internal endorser
  unknown             -- not yet classified
}
```

Asset class classification (the field that drives critical-asset and engagement rules):

```
asset.asset_class ∈ {
  pricing_doc,
  msa, dpa, contract,
  security_questionnaire, soc2_report,
  mutual_action_plan,
  demo_recording, sales_call,
  marketing_form, demo_request, pricing_inquiry,
  webpage_pricing, webpage_security, webpage_competitor,
  newsletter_email, sequence_email,
  meeting,
  invoice,
  support_ticket,
  news_article, sec_filing
}
```

The `asset_class` is the cross-source comparable. A Dock pricing PDF view and a Webflow pricing page view both reduce to `asset_class = 'pricing'` for correlation purposes.

---

## 3. The relational schema

Postgres / Supabase. This replaces and extends the current `external_signals` + `inbound_emails` tables.

### Core entities

```sql
-- ACCOUNTS: unified buyer-company record
create table accounts (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                  -- 'acc_helios'
  name            text not null,
  primary_domain  text not null,                          -- 'helios.com'
  alt_domains     text[] default '{}',                    -- ['helios.io', 'gohelios.com']
  industry        text,
  employee_count  int,
  arr_tier        text,                                   -- 'enterprise' | 'mid' | 'smb'

  -- external system IDs (the identity resolution surface)
  sfdc_account_id        text unique,
  hubspot_company_id     text unique,
  zoominfo_company_id    text unique,
  zendesk_organization_id text unique,
  xero_contact_id        text unique,
  dock_workspace_id      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index accounts_domain on accounts (primary_domain);

-- PEOPLE: humans, role-classified, identity-resolved across tools
create table people (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  email           text not null,
  alt_emails      text[] default '{}',
  name            text,
  title           text,

  -- role classification (drives committee_gap + champion rules)
  role            text not null default 'unknown',       -- enum above
  is_primary_champion boolean default false,
  is_active       boolean default true,
  departed_at     timestamptz,                            -- set when champion_loss fires

  -- external IDs
  sfdc_contact_id        text unique,
  hubspot_contact_id     text unique,
  zoominfo_person_id     text unique,
  outreach_prospect_id   text unique,
  zendesk_user_id        text unique,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index people_account_email on people (account_id, email);
create index people_role on people (account_id, role);

-- OPPORTUNITIES: SFDC mirror, the deal-cycle instance
create table opportunities (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  sfdc_opportunity_id text unique not null,
  name            text not null,
  stage           text not null,
  stage_changed_at timestamptz not null,
  amount          numeric,
  close_date      date,
  owner_user_email text,                                  -- the AE
  opp_type        text,                                   -- 'new_logo' | 'expansion' | 'renewal'

  -- MEDDPICC anchors
  economic_buyer_person_id  uuid references people(id),
  primary_champion_person_id uuid references people(id),
  decision_criteria_updated_at timestamptz,
  next_steps_updated_at        timestamptz,

  is_open         boolean not null default true,
  closed_at       timestamptz,
  won             boolean,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index opportunities_account_open on opportunities (account_id, is_open);
create index opportunities_stage on opportunities (stage, is_open);

-- INITIATIVES: pre-opportunity slot for shadow_research / cold-account signals
create table initiatives (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references accounts(id),
  label           text not null,                          -- 'intent_surge_clm', 'website_research'
  source_tool     text not null,
  first_observed_at timestamptz not null,
  last_observed_at  timestamptz not null,
  promoted_to_opportunity_id uuid references opportunities(id),
  created_at      timestamptz not null default now()
);

-- ASSETS: the thing the buyer touched
create table assets (
  id              uuid primary key default gen_random_uuid(),
  source_tool     text not null,                          -- 'dock', 'gong', 'webflow', ...
  source_asset_id text,                                   -- ID in the source system
  asset_class     text not null,                          -- enum above
  name            text,
  url             text,
  opportunity_id  uuid references opportunities(id),
  initiative_id   uuid references initiatives(id),
  created_at      timestamptz not null default now()
);
create unique index assets_source on assets (source_tool, source_asset_id);
create index assets_opportunity_class on assets (opportunity_id, asset_class);
```

### The unified signal table

```sql
create table signals (
  id              uuid primary key default gen_random_uuid(),

  -- provenance
  source_tool     text not null,                          -- 'salesforce' | 'gong' | 'dock' | ...
  source_event_id text,                                   -- idempotency key (webhook id, etc.)
  occurred_at     timestamptz not null,                   -- when it happened in reality
  detected_at     timestamptz not null default now(),     -- when Dugout saw it

  -- classification (the ontology overlay)
  signal_type     text not null,                          -- canonical taxonomy: champion_loss | committee_gap | ...
  severity        text not null,                          -- 'blocking' | 'action' | 'awareness'
  direction       text not null default 'negative',       -- 'negative' | 'positive' | 'neutral'
  confidence      smallint not null default 50,           -- 0–100; derived from source quality

  -- entity references (nullable as appropriate)
  account_id      uuid not null references accounts(id),
  person_id       uuid references people(id),
  opportunity_id  uuid references opportunities(id),
  initiative_id   uuid references initiatives(id),
  asset_id        uuid references assets(id),

  -- payloads
  raw             jsonb not null,                         -- original event from source
  derived         jsonb,                                  -- computed fields (latency_delta, days_in_stage, etc.)

  -- routing / orchestration
  rule_id         text references rules(id),
  suggested_action text,                                  -- human-readable next step
  task_id         uuid,                                   -- references tasks(id) when one is created
  suppressed_until timestamptz,                           -- debounce window

  created_at      timestamptz not null default now()
);

-- HOT-PATH INDEXES
create index signals_account_time on signals (account_id, occurred_at desc);
create index signals_opp_severity on signals (opportunity_id, severity, occurred_at desc);
create index signals_type_account_time on signals (signal_type, account_id, occurred_at desc);
create index signals_person_type on signals (person_id, signal_type, occurred_at desc);
create unique index signals_idempotency on signals (source_tool, source_event_id)
  where source_event_id is not null;
```

### Correlations: the moat made queryable

A *correlation* is an emergent record created when multiple signals of the same `signal_type` reinforce each other within a time window. Single-source signals are noisy; multi-source correlations are defensible.

```sql
create table signal_correlations (
  id              uuid primary key default gen_random_uuid(),

  correlation_type text not null,                         -- same as signal_type: 'champion_loss', etc.
  account_id      uuid not null references accounts(id),
  opportunity_id  uuid references opportunities(id),
  person_id       uuid references people(id),             -- e.g., the departing champion

  signal_ids      uuid[] not null,                        -- the corroborating signals
  source_tools    text[] not null,                        -- denormalized for fast query
  source_count    int generated always as (cardinality(source_tools)) stored,

  -- the elevated severity (correlations can elevate single-signal tier)
  derived_severity text not null,
  confidence      smallint not null,                      -- typically > any single signal

  first_observed_at timestamptz not null,
  last_reinforced_at timestamptz not null,
  task_id         uuid,                                   -- the task this correlation drove
  resolved_at     timestamptz,
  resolution      text,                                   -- 'true_positive' | 'false_positive' | 'auto_expired'

  created_at      timestamptz not null default now()
);
create index correlations_account_open on signal_correlations (account_id, resolved_at)
  where resolved_at is null;
```

### Rules: data, not code

The 13 rules currently in `signal-engine.ts` (plus the 42 implied by the dictionaries) get registered in a table so the dictionary and the engine stay in sync.

```sql
create table rules (
  id              text primary key,                       -- 'champion_reply_latency_decay'
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

## Tiered storage — "include all information" without bankrupting the system

The schema above is the **hot store**: structured entities + signals + correlations, optimized for sub-100ms queries powering UX surfaces. But the dictionaries describe richer payloads — full call transcripts, full email bodies, document text, daily ZoomInfo enrichment snapshots, raw webhook envelopes. Throwing all of that into Postgres makes queries slow and storage costs ugly. Throwing it away makes the AI query layer dumb (it can't answer "what did the buyer actually say on the May 14 call?").

The answer is a **three-tier storage model**. Every adapter writes to the appropriate tier; the AI layer reaches across all three.

| Tier | What lives there | Storage | Latency | Retention |
|---|---|---|---|---|
| **Hot** (Postgres tables in §3) | Structured entities, derived signals, correlations, rule registry | Supabase Postgres | <100ms | Forever |
| **Warm** (`signals.raw` JSONB + dedicated payload tables) | Raw webhook bodies, full inbound emails, raw API responses, normalized engagement events | Postgres JSONB or Supabase Storage (parquet daily roll-up) | 100–500ms | 90–365 days (configurable) |
| **Cold** (Supabase Storage / S3) | Full call transcripts, document extracted-text (MSA / pricing PDFs / security questionnaires), historical enrichment snapshots, raw audio/video pointers | Object storage | 1–5s | Forever |

### What writes where, by source

| Source | Hot | Warm | Cold |
|---|---|---|---|
| Salesforce | Account, Opportunity, OCR snapshots; signals for stage/role/field changes | Full Opportunity/Contact field history JSONB; raw Platform Event payloads | — |
| Gong | Call metadata, participant roles, tracker hit summaries, derived signals | Tracker hit details with timestamps and speaker IDs | Full transcript text (S3); audio URL pointer only |
| Outreach | Sequence state, prospect engagement summaries, derived signals | Raw mailing/reply webhook bodies | — |
| Dock | Asset metadata, viewer events summarized, derived signals | Per-asset-per-user event log JSONB | Asset content extracted text (MSA, pricing PDF) |
| HubSpot | Contact/Company sync, form submissions, lifecycle changes | Raw webhook bodies, page-view history | — |
| ZoomInfo | Person/company current state, latest job change, intent scores | Intent topic history JSONB | Daily enrichment snapshots (so we can show "what did we know about this account on May 1?") |
| Inbound email | Email metadata, classifier output, derived signals | Full email body in `inbound_emails.body` (already exists) | Long-term email archive (S3 after 365d) |
| NewsAPI / SEC | News article metadata, classifier output, derived signals | Full article text JSONB | — |
| Chili Piper, Nooks, Swyft, Zendesk, Xero, Webflow | Same pattern: summaries hot, raw payloads warm, large blobs cold | | |

### Why this works

1. **Every UX surface** runs against the hot tier — fast, cheap, predictable.
2. **The AI query layer** (next section) starts in hot, paginates into warm/cold only when the question demands it.
3. **Signal-logic rewrites** don't require re-ingestion — replay over the warm tier with new rules.
4. **Compliance** — cold-tier retention policies are tunable per data type (e.g., delete inbound email bodies after 365d if a customer's DPA requires it).

### Cost back-of-envelope

For one Checkbox-scale customer (assume 500 active opps, 200 calls/week, 1k emails/week, 50 deal rooms with 200 weekly engagements):
- **Hot:** ~5M rows/year across all tables. Supabase Pro tier ($25/mo) handles this comfortably.
- **Warm:** ~50GB/year of JSONB. ~$1/GB/mo on Postgres = $50/mo, OR $0.023/GB/mo on S3 = $1.50/mo. Recommend S3 for warm beyond 30d.
- **Cold:** ~200GB/year of transcript + document text. $5/mo on S3.

**~$30–80/mo per customer for full-fidelity storage.** Negligible vs. the per-seat pricing of any tool in the stack.

---

## 4. Correlation queries: the product made executable

Two worked examples. Both are real Postgres queries that would run as scheduled jobs or live triggers.

### Example A — `champion_loss` correlation across 4 sources

```sql
-- Find accounts where 2+ different tools reported champion_loss in last 14 days
-- and there's an open Selected Vendor (or later) opportunity.

with recent as (
  select
    s.account_id,
    s.person_id,
    s.id as signal_id,
    s.source_tool,
    s.occurred_at,
    s.confidence
  from signals s
  where s.signal_type = 'champion_loss'
    and s.occurred_at > now() - interval '14 days'
),
correlated as (
  select
    account_id,
    person_id,
    array_agg(signal_id) as signal_ids,
    array_agg(distinct source_tool) as source_tools,
    count(distinct source_tool) as source_count,
    max(occurred_at) as last_reinforced_at,
    min(occurred_at) as first_observed_at
  from recent
  group by account_id, person_id
  having count(distinct source_tool) >= 2
)
select
  c.*,
  o.id as opportunity_id,
  o.stage,
  o.amount,
  o.owner_user_email
from correlated c
join opportunities o
  on o.account_id = c.account_id
  and o.is_open = true
  and o.stage in ('Selected Vendor', 'Negotiation', 'Verbal')
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
  from signals s
  join opportunities o on o.id = s.opportunity_id
  where s.signal_type = 'committee_gap'
    and o.is_open = true
    and o.stage = 'Selected Vendor'
    and s.occurred_at > now() - interval '21 days'
  group by s.opportunity_id, s.account_id
)
select
  os.*,
  o.amount,
  o.owner_user_email,
  -- corroborating context: which committee roles ARE present?
  array(
    select distinct p.role
    from people p
    join opportunities_contacts oc on oc.person_id = p.id
    where oc.opportunity_id = os.opportunity_id
  ) as present_roles
from opp_signals os
join opportunities o on o.id = os.opportunity_id
where source_count >= 2
order by source_count desc, last_signal_at desc;
```

**What this produces:** a BLOCKING list of "Selected Vendor opps where Salesforce *and* Dock *and* Gong all independently report no Finance/IT/Legal engagement." That's not "one rule fired" — that's "three independent systems agree, and here's exactly which committee roles you're missing."

---

## The AI query layer — "ask questions across integrations"

The schema + tiered storage make this layer cheap and obvious. Architecture: a **tool-use agent** (Anthropic SDK, which Dugout already uses for the digest) given a small set of typed query tools over the unified store. User asks a natural-language question; the agent picks tools, retrieves grounded data, synthesizes an answer with citations.

### The tool set (~8 functions)

```typescript
// All tools return typed, citable results with source signal_ids
// so the agent's answer can link back to specific evidence.

tools = [
  // Account-level context
  get_account_context(account_slug, days=90): {
    accounts row, open opportunities, key people by role, recent correlations
  },

  // Time-ordered cross-source event stream
  get_account_timeline(account_slug, days=30, source_filter?): Signal[]
    // joins signals + correlations across all sources, chronological

  // Search by signal_type
  find_signals(signal_type, scope: {account|owner|team}, days): Signal[]

  // Cross-source correlation lookup
  get_correlations(scope, types[], days, min_sources=2): Correlation[]

  // Call/transcript retrieval (reaches into cold store)
  get_calls(opportunity_id, limit=5): {metadata, transcript_excerpt, gong_url}

  // Email thread retrieval (warm store)
  get_emails(account_id, person_id?, days=30): Email[]

  // Document engagement
  get_committee_engagement(opportunity_id): {
    present_roles[], missing_roles[], per_asset_views, last_visit_per_person
  },

  // Aggregations for manager-level questions
  rollup(metric, dimension: {rep|stage|segment|competitor}, window): {...}
]
```

### Worked example — "Why is the Helios deal stalling?"

```
User: Why is the Helios deal stalling?

Agent calls get_account_context("acc_helios", 90):
  → Helios Manufacturing, stage=Selected Vendor (23d), $185K, owner=sarah@checkbox
  → Champion: Maria Chen (VP Eng), EB: Tom Wright (CFO)
  → 1 active correlation: champion_disengagement, confidence=82, 3 sources

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

Citations: [signal_id_1, signal_id_2, ...] each clickable to the source event.
```

### Two surfaces

| Surface | Audience | Pattern |
|---|---|---|
| **`/ask` route** | Both AE and Manager | Full chat thread, conversational follow-ups, exportable. The "deep work" surface. |
| **Drawer chat panel** | AE on a specific account | Pre-scoped to the open account; first question prefilled ("brief me on this account"). The "in-flow" surface. |

### Cost model

- Sonnet 4.6 per question: ~$0.02-0.10 depending on how many tools the agent uses
- **Prompt caching** on hot accounts: cache the account_context + recent timeline; subsequent questions on same account drop to <$0.01
- At 9 AEs × ~5 questions/day = ~45 questions/day → ~$1-5/day per Checkbox-scale customer

### What this DOES NOT do

- **No writes to source systems.** This layer is read-only intelligence. Updating Salesforce, sending emails, etc. is out of scope. Earn the write later.
- **No prediction without evidence.** The agent only states what the signals show. "The deal is at risk because X, Y, Z" — never "the deal will close at 70% probability" without a calibrated model behind it.
- **No cross-customer learning.** Each org's data stays in their tenant. No "Dugout learned from 500 other deals that this pattern predicts loss."

---

## 5. Identity resolution — the hardest practical problem

Every signal in this model assumes we can answer: *given an email, a domain, a company name, a ZoomInfo personId, a Salesforce Contact.Id — is this the same human/account?*

This is the single hardest engineering problem in the build. Without solving it, every cross-source correlation misfires.

### Account resolution

| Input | Resolution path | Failure mode |
|---|---|---|
| `domain` (`helios.com`) | Lookup `accounts.primary_domain` or `accounts.alt_domains` | Subsidiaries, parent companies, multi-domain orgs |
| `sfdc_account_id` | Direct join on `accounts.sfdc_account_id` | None if SFDC is system of record |
| `hubspot_company_id` | Direct join, but HubSpot Companies aren't always 1:1 with SFDC Accounts | Orphan HubSpot Companies, manual merge required |
| `zoominfo_company_id` | Build mapping table at first enrichment | ZI companyId changes on M&A |
| `xero_contact_id` | Billing entity ("Helios Corp - AP") often ≠ sales account | Fuzzy match + override table |

**Strategy:** the `accounts` table is the canonical record. Every adapter's first job on a new payload is to call `resolveAccount(payload)` which returns an `account_id` or creates a new one. Single point of identity logic; testable in isolation.

### Person resolution

| Input | Resolution path | Failure mode |
|---|---|---|
| `email` | Lookup `people.email` or `people.alt_emails` scoped to account_id | Personal Gmail addresses for procurement/legal |
| `sfdc_contact_id` | Direct join | None |
| `zoominfo_person_id` | Direct join — *but ZI's personId stability across job changes is an open question* | If unstable, must fall back to email+name fuzzy |
| Title regex (for role classification) | Heuristic `classifyRole(title)` → role enum | False positives on non-standard titles (e.g., "Director of Special Projects") |

**Strategy:** same as accounts — `resolvePerson(account_id, identifiers)` → `person_id`. Maintain alt_emails array to absorb the personal-email problem.

### What we do NOT try to solve

- **Cross-account person tracking** (champion moves from Helios to Atlas) — we *do* want to detect this (it's `champion_loss` at Helios + `new_economic_buyer` at Atlas) but we don't try to unify the personId across the move. ZoomInfo does that for us via their people graph.
- **Anonymous → identified stitching for website visitors** — that's the de-anon vendor's job (HubSpot, Clearbit Reveal). We consume identified events only.

---

## 6. Migration from current state

Dugout today has:
- `external_signals` table (NewsAPI + SEC + inbound email writes here)
- `inbound_emails` table (raw email storage before classification)
- In-memory accounts (seed.ts, 11 public-co fixtures)
- Cookie-backed workspace config
- localStorage-backed tasks

**Migration path** (no big-bang rewrite):

1. **Create the new tables alongside `external_signals`.** No deletes. Both run in parallel.
2. **Backfill `accounts` + `people` from `seed.ts`.** ~11 accounts, ~30 contacts. One-time script.
3. **Rewrite the 3 live adapters (NewsAPI, SEC, inbound email) to dual-write** — into the new `signals` table *and* the old `external_signals`. Two weeks of dual-write to verify parity.
4. **Add the 12 new tool adapters** writing only to the new `signals` table. Each one starts with one signal (the Tier-S signal per the dictionary) and grows.
5. **Re-point `signal-engine.ts`** at the new table. Keep the existing 13 rules; add the dictionary-derived rules as they're built.
6. **Add `signal_correlations` job** — runs every 5 min, materializes the 5 cross-tool patterns.
7. **Migrate tasks to Supabase** (already on the roadmap as Strategic Rec #3 in the handoff).
8. **Retire `external_signals` table** once parity is proven.

Estimated migration effort: **~2 weeks single-engineer** for steps 1–4. Steps 5–8 are incremental.

---

## 7. What this unlocks — every correlation is a product

The reason this synthesis is non-skippable: **every `signal_type` correlation that fires across 2+ sources is a defensible product feature.** Each one is a section of a website. Each one is a slide in the demo.

| Product feature | What fires it | Why it's defensible |
|---|---|---|
| **Multi-source Champion Departure Detection** | `champion_loss` correlation ≥2 sources | UserGems sees ZoomInfo only. We see 4 sources — and we explain which 2+ agreed. |
| **Buying Committee Health Score** | `committee_gap` correlation across SFDC + Dock + Gong + Swyft | Per-opp 0–100 score with the missing roles named. No one else combines deal-room + call-attendance + CRM-structure. |
| **Deal Stall Early Warning** | `champion_disengagement` correlation across Dock + Outreach + Gong + HubSpot + Chili Piper | 5 sources, confidence-weighted. The "your champion is going dark" alert with receipts. |
| **Competitive Threat Radar** | `competitive_threat` correlation, with Gong-verified verbal mention as highest weight | Distinguishes "buyer said it on a call" from "buyer's coworker viewed a comparison page" — and weights accordingly. |
| **Cold-Account Activation** | `shadow_research` correlation on accounts with no open opp → auto-create `initiative` | Intent surge + WebSights visit + form fill from same account = the SDR's pre-warmed lead. |
| **Expansion-Deal Red Flag** | `account_health_decline` correlation across Zendesk + Xero on active expansion opps | "Don't pitch the upsell — they have 3 open P1s and AR is 60 days overdue." |
| **Reference Customer Watchlist** | `account_health_decline` on accounts tagged `reference_status=active` | Stop using a now-unhappy customer on reference calls before the AE finds out the hard way. |
| **Renewal Quarterback** | `lifecycle_milestone` (renewal_window) + 90d signal history per account | Auto-briefs the AE with what happened over the year, who engaged when, what risks accumulated. |
| **MEDDPICC Completeness Score** | `data_hygiene_gap` correlation per opp *(future — awaits Swyft wiring)* | RevOps dashboard: which AEs have the cleanest deal hygiene, where Swyft is failing to extract. |
| **Pre-meeting Intel Brief** *(new — powered by `account_context` + `vertical_context`)* | Account news + vertical trends in last 30d auto-rendered 15 min before any external calendar event | The "no cold meetings" product principle made literal. NewsAPI + SEC + newsletter inbox are already producing the signals; just need to render them per-meeting. |
| **Newsletter Intelligence (already shipping)** | Inbound email classifier → `shadow_research` or `competitive_threat` signals attached to accounts | The "subscribe Dugout to your buyer's reading list" feature. No competitor has this. |

**10 products. One schema.** Adding tool #13 doesn't require new product surface — it slots into existing signal_types and the existing 10 products get more accurate.

---

## How this schema powers the case-derived metrics

The schema is the substrate; the metrics it produces are what the interview panel cares about. Full formula in [metrics.md](metrics.md). Here's the schema→metric chain for the hero metric (**Selected Vendor Health Score**):

```
Source webhook  →  signals row  →  signal_correlations row  →  component score  →  SV Health Score
─────────────      ─────────────    ───────────────────────    ──────────────       ────────────────
Dock asset       Dock relay        committee_gap                Buying-committee     Weighted sum,
view event   →   write to       →  (3 sources agree:        →  coverage = 40    →   0–100 per opp
(Salesforce      signals with       SFDC OCR + Dock           (×0.30 weight)
managed pkg)     signal_type=       silence + Gong call
                 committee_gap      attendance)
                 + source_event_id
                 (idempotency)
```

Every component score in the SV Health formula has this same shape:

| Component | Weight | Reads from | Powered by signal_type(s) |
|---|---|---|---|
| Time-in-stage | 20% | `opportunities.stage_changed_at` | Salesforce stage change |
| Committee coverage | 30% | `signals` joined to `people` by role | `committee_gap`, `committee_expansion` |
| Enablement deployment | 20% | `signals` filtered to `asset_class IN (cfo_brief, it_brief, finance_brief)` | `shadow_research` (asset views by external viewers) |
| Champion engagement | 20% | `signals` filtered to `person_id = primary_champion` | `champion_disengagement` |
| Risk penalty | -10% to 0 | Active `signal_correlations` on the opp | All BLOCKING-tier correlations |

**Traceability:** any score on the dashboard can be drilled to: component score → signals that fed it (with `source_event_id`) → source webhook payload at `occurred_at` → click into source system. This is what makes the system defensible when an AE asks "why did Dugout flag this deal?"

The schema was designed for this from day one — no retrofit needed.

---

## 8. Open design questions

These are the calls Jackson needs to make (or get RevOps input on) before code:

1. **Asset class taxonomy** — the enum above is my draft. Is `mutual_action_plan` distinct from `meeting`? Does `sec_filing` warrant its own class or fold into `news_article`? Editing this enum after launch is expensive.

2. **Confidence scoring policy** — I've specified `0–100`. Two open questions: (a) does each signal_type have its own scoring function, or is there a universal one? (b) does correlation-derived confidence cap at 100 or compound?

3. **`signal_correlations` materialization cadence** — every 5 min (cheap, near-real-time) vs. on-demand at task-list query time (expensive at query, no staleness). BLOCKING-tier should be 5 min; AWARENESS can be hourly.

4. **Auto-resolution rules** — when does a correlation auto-close? E.g., `champion_loss` correlation should auto-resolve when a new champion is added to the OCR. Without this, the task list becomes a graveyard.

5. **Initiative → Opportunity promotion** — what makes an `initiative` (cold-account shadow research) graduate to an `opportunity`? Manual SDR action? Auto-promote on 3rd signal? This is a real product decision, not an engineering one.

6. **Multi-tenancy** — does the schema have a `workspace_id` on every table from day one (yes), or do we defer until the second customer (no)? Recommend yes; the cost is zero today and the rewrite cost later is huge.

---

## 9. The one-paragraph version

Every signal across every tool — internal CRM/marketing/sales/CS systems *and* live-world feeds like email, news, and SEC — fits one Postgres table called `signals`, references 5 ontology entities (Account, Person, Opportunity, Initiative, Asset), and classifies into 10 canonical `signal_type` values. Cross-source correlation is a SQL query: "give me accounts where 2+ tools reported the same signal_type in the last N days." Each correlation is a defensible product feature with an explainable evidence trail. The hard problem is identity resolution (one Person across 12 tools); everything else is plumbing. Migration from current state is 2 weeks of dual-write parallel to the existing `external_signals` table — no big-bang rewrite.

---

## See also

- `dictionary.md` — the 12-tool index this synthesis is built on
- `tools/*.md` — per-tool signal cards with raw API surface, rule shapes, effort estimates
- `src/lib/signal-engine.ts` — current 13-rule engine (the migration target)
- `supabase/migrations/` — where the actual schema lands when this ships
