# Zippering — Build Plan

Status: draft, awaiting review · Author: Jackson + Claude · 2026-05-25

---

## 1. What we're building

**Zippering** is Haiku-driven schema reconciliation at ingest, per primary
key. When a new signal arrives from any integration (Granola, SEC, AgentMail,
Firecrawl, NewsAPI, future HubSpot/Salesforce/Linear/whatever), the zipperer:

1. Routes the row to its owning account via primary key.
2. For each column in the incoming row, decides whether to **join** it into
   an existing canonical column on that pkey's wide row (semantic match) or
   **append** it as a new column.
3. Persists the decision so the next row from the same integration doesn't
   re-pay the Haiku cost.

End state: one wide row per pkey, with shared columns merged and dissimilar
columns extending the row width. The pkey is the load-bearing thread.

### Concrete example

A Granola transcript arrives:
```
{ meeting_date: "2026-05-22", attendees: ["jane@stripe.com"],
  summary: "Champion called out budget concerns", risk_flags: ["budget"] }
```

Resolved to `pkey: acc_stripe`. The zipperer's current schema for that
pkey already has:

| Canonical column | Sources writing here so far |
| --- | --- |
| `occurred_at`     | sec_edgar.filing_date, newsapi.published_at |
| `content`         | sec_edgar.description, newsapi.body |
| `risk_signals`    | (none yet) |

Haiku verdicts on each Granola column:
- `meeting_date` → JOIN into `occurred_at`
- `attendees` → APPEND (no semantic match)
- `summary` → JOIN into `content`
- `risk_flags` → APPEND (matches `risk_signals` only weakly; surface for review)

Resulting wide row for `acc_stripe`:
```
{ pkey: "acc_stripe", occurred_at, content, attendees, risk_flags, ... }
```

Reads against `acc_stripe` get the full union, with shared columns already
collapsed and dissimilar columns visible side by side.

---

## 2. Architecture at a glance

```
┌──────────────────────┐   ┌──────────────────────┐
│  Integration adapter │   │  Integration adapter │
│  (Granola, SEC, etc.)│   │  (HubSpot, ...)      │
└──────────┬───────────┘   └──────────┬───────────┘
           │                          │
           ▼                          ▼
        ┌────────────────────────────────────┐
        │           ZIPPERER (lib)           │
        │                                    │
        │  1. Resolve pkey                   │
        │  2. For each column:               │
        │       cached? → use decision       │
        │       new?   → call Haiku → cache  │
        │  3. Write to zippered_signals      │
        └──────────────┬─────────────────────┘
                       │
                       ▼
        ┌────────────────────────────────────┐
        │  Supabase                          │
        │   • zippering_schema (per pkey)    │
        │   • zippering_decisions (cache)    │
        │   • zippered_signals (wide rows)   │
        │   • zippering_conflicts (audit)    │
        └──────────────┬─────────────────────┘
                       │
                       ▼
        ┌────────────────────────────────────┐
        │  Reads: getZipperedRow(pkey),      │
        │  getZipperedTimeline(pkey, since), │
        │  /account/[slug], /market-intel    │
        └────────────────────────────────────┘
```

Two abstractions that matter:
- **Schema registry** (`zippering_schema` + `zippering_decisions`) — the cached
  brain. Knows that `meeting_date` from Granola maps to `occurred_at` for
  `acc_stripe` so we don't re-Haiku.
- **Zippered store** (`zippered_signals`) — the wide rows themselves, JSONB-
  backed so the schema can grow without migrations.

---

## 3. Data model

Four new Supabase tables. All RLS deny-all + service-role only (matches
existing posture per `reference_dugout_tooling`).

### `zippering_schema`
Per-pkey list of canonical column names.

```sql
create table zippering_schema (
  id              uuid primary key default gen_random_uuid(),
  pkey            text not null,                 -- AccountId
  canonical_name  text not null,                 -- e.g. "occurred_at"
  data_type       text not null,                 -- "timestamp" | "text" | "jsonb" | "string[]"
  first_source    text not null,                 -- integration that introduced this column
  first_seen_at   timestamptz not null default now(),
  unique (pkey, canonical_name)
);
```

### `zippering_decisions`
Cache of Haiku verdicts. The hot path is `SELECT WHERE pkey = ? AND source = ? AND source_column = ?`.

```sql
create table zippering_decisions (
  id                uuid primary key default gen_random_uuid(),
  pkey              text not null,
  source            text not null,                -- "granola" | "sec_edgar" | "newsapi" | ...
  source_column     text not null,                -- "meeting_date"
  verdict           text not null check (verdict in ('join','append','unclear')),
  canonical_name    text,                          -- set when verdict='join' or 'append'
  similarity_score  numeric,                       -- Haiku-reported 0..1
  reason            text,                          -- one-line Haiku justification
  needs_review      boolean not null default false, -- true when verdict='unclear'
  decided_at        timestamptz not null default now(),
  unique (pkey, source, source_column)
);
```

### `zippered_signals`
Wide rows. JSONB for the dynamic-schema columns.

```sql
create table zippered_signals (
  id              uuid primary key default gen_random_uuid(),
  pkey            text not null,
  source          text not null,
  external_id     text,                           -- integration's native id, for idempotent re-ingest
  occurred_at     timestamptz not null,           -- always present (the one canonical column we mandate)
  columns         jsonb not null default '{}'::jsonb,  -- all other canonical columns flatten in here
  ingested_at     timestamptz not null default now(),
  unique (source, external_id)                    -- idempotent re-ingest
);
create index zippered_signals_pkey_time on zippered_signals (pkey, occurred_at desc);
```

### `zippering_conflicts`
Audit trail for when two integrations disagree on a JOINED column's value.

```sql
create table zippering_conflicts (
  id              uuid primary key default gen_random_uuid(),
  pkey            text not null,
  canonical_name  text not null,                  -- which column disagreed
  source_a        text not null,
  value_a         jsonb,
  source_b        text not null,
  value_b         jsonb,
  occurred_at     timestamptz not null,           -- when the conflicting source wrote
  resolution      text,                           -- "latest_wins" | "source_priority" | "manual"
  detected_at     timestamptz not null default now()
);
```

**Why JSONB for `columns`**: lets the schema grow without migrations. Cost:
queries that filter on a column-inside-columns get slower. Mitigation: every
canonical column is also indexed via `zippering_schema` so reads know which
JSONB keys exist for a pkey.

**Why a hard-coded `occurred_at`**: every signal we care about has a time.
Pulling it out of JSONB into a typed column lets the time-series indexes do
real work.

---

## 4. The Haiku assessment

The load-bearing call. One prompt, one output schema, called per
`(pkey, source, source_column)` that hasn't been decided yet.

### Prompt template

```
You are deciding whether two columns from different data sources are the same
field semantically. Return a JOIN verdict if they're the same kind of data;
APPEND if they're different; UNCLEAR if you can't tell from the samples.

INCOMING COLUMN
  source:        {{source}}
  column_name:   {{source_column}}
  sample_values: {{3-5 sample values from recent rows}}

EXISTING CANONICAL COLUMNS FOR THIS ACCOUNT
{{for each: name, data_type, source_examples, sample_values}}

Return JSON only:
{
  "verdict": "join" | "append" | "unclear",
  "canonical_name": string | null,
  "similarity_score": number between 0 and 1,
  "reason": string (one sentence, no preamble)
}

Rules:
- "join" only when the columns clearly carry the same kind of data
  (timestamp vs timestamp; identifier vs identifier; free text vs free text).
- "append" when the column is new in kind.
- "unclear" when sample values are inconsistent or ambiguous; do not guess.
- canonical_name is always set: echoes existing column on "join", suggests
  a new column name on "append", and on "unclear" suggests a new column
  name (the unclear case is appended into its own canonical column AND
  flagged for human review — see Ingest Flow §5).
```

### Output shape

```ts
interface ZipperingVerdict {
  verdict: 'join' | 'append' | 'unclear';
  canonical_name: string | null;
  similarity_score: number;       // 0..1
  reason: string;
}
```

### When invoked
Only on **first-ever ingest** of a `(pkey, source, source_column)` triple. After
the decision is cached in `zippering_decisions`, every subsequent row from
that source for that pkey uses the cached verdict — zero Haiku cost.

### Model
Haiku 4.5 at `temperature: 0` (per the lessons from `email-filter.ts:513` — we
don't want this drifting). `max_tokens: 256`, `tool_choice: { type: 'tool' }`
with a strict JSON schema enforced.

---

## 5. Ingest flow

```
adapter.ingest(rawRow)
  ↓
resolvePkey(rawRow)                       // sender_domain → AccountId
  ↓
for each column in rawRow:
  decision = zippering_decisions.lookup(pkey, source, column)
  if not decision:
    decision = haiku.assess(pkey, source, column, samples)
    zippering_decisions.insert(decision)
    if decision.verdict == 'append':
      zippering_schema.insert(pkey, decision.canonical_name)
  ↓
build wide row:
  canonical_columns = {}
  for each column in rawRow:
    decision = ... (already loaded)
    # 'unclear' is treated identically to 'append' on the write path — the
    # column gets a real canonical_name and a real value. The decision row
    # carries needs_review = true so an operator can later promote it to a
    # 'join' against an existing canonical column (or confirm the append).
    # No data is parked under special prefixes; nothing is dropped.
    canonical_columns[decision.canonical_name] = value
  ↓
zippered_signals.upsert(
  pkey, source, external_id,
  occurred_at = canonical_columns.pop('occurred_at'),
  columns = canonical_columns
)
  ↓
if conflict detected (existing row at similar timestamp, same canonical column,
                       different value, source != source_b):
  zippering_conflicts.insert(...)
```

The cold-path Haiku call is the only place we pay; everything else is a
Supabase upsert.

---

## 6. Reads

### Operator review of unclear decisions

Every `unclear` verdict creates a real canonical column AND sets
`needs_review = true` on the decision row. The values flow into the zippered
store immediately — nothing is parked or dropped. A reviewer surface (`/zippering/review`,
shipped in Phase 5 below) lists every `needs_review = true` decision so an
operator can promote it to a `join` against an existing column, confirm the
append as-is, or override the canonical name.

When an operator promotes an `unclear` to a `join`:
1. The decision row updates: `verdict='join'`, `needs_review=false`,
   `decision_override_by=<rep_id>`, `canonical_name=<target>`.
2. A one-shot backfill walks `zippered_signals` for that pkey + source,
   renaming the key inside the `columns` JSONB from the old canonical name to
   the new one (`UPDATE ... SET columns = jsonb_set(columns - 'old', '{new}', columns->'old')`).
3. Subsequent ingests honor the new verdict via the cache — no re-Haiku.

Until Phase 5 ships the UI, `needs_review` rows are queryable via direct SQL.
Aim is to keep the queue small: §12 success criteria say ≥90% of decisions
are confident; unclear is the long-tail bucket, not the default.

### Per-account wide row
```ts
getZipperedRow(pkey: AccountId): Promise<ZipperedRow>
```
Returns the latest signal per canonical column (latest-write-wins by
`occurred_at`). Used by `/account/[slug]` for the drawer's top-line summary.

### Time-series flat
```ts
getZipperedTimeline(pkey: AccountId, since: string): Promise<ZipperedSignal[]>
```
Returns the raw `zippered_signals` rows for one pkey, ordered by
`occurred_at desc`. Used by the account timeline + `/market-intel` per-account
section.

### Cross-account
```ts
getZipperedAcrossPkeys(filter: { canonical_name?: string, since?: string }): Promise<ZipperedSignal[]>
```
Used by the workspace inbox to query across all pkeys with a canonical filter
(e.g. "all signals where `risk_signals` is non-empty in the last 7d").

### Backwards compatibility shim
During the migration phase, a Supabase view projects `zippered_signals` into
the existing `external_signals` shape so legacy code paths keep working:

```sql
create view external_signals_compat as
select
  pkey as account_id,
  source,
  columns->>'content' as summary,
  occurred_at,
  ...
from zippered_signals;
```

---

## 7. Cost + caching

| Decision | Haiku cost |
| --- | --- |
| First ingest of `(pkey, source, column)` | ~1 Haiku call, ~$0.0003 |
| Subsequent ingests of same triple | 0 (cache hit) |

Worst-case onboarding cost for a fresh pkey with all 6 current integrations:

- 6 integrations × ~12 columns each = ~72 first-time decisions
- 72 × $0.0003 ≈ $0.022 per fully-onboarded pkey

That's the **upper bound** — most integrations re-use the same canonical
columns (`occurred_at`, `content`) discovered by earlier integrations, so most
decisions are JOINs that just confirm an existing canonical name rather than
appending. Realistic: ~$0.005-$0.015 per new pkey.

Per-row steady-state cost (after warm): 0. Just Supabase upserts.

---

## 8. Conflict policy

When two integrations write to the same canonical column for the same pkey
with different values inside a short window, we have a conflict.

Default resolution: **latest wins** by `occurred_at`. The new row's value
becomes the row's current value; the old row stays in `zippered_signals` as
history.

Audit: write the conflicting pair to `zippering_conflicts` so an operator can
review.

Future enhancements (deferred, post-MVP):
- **Source priority by canonical column** — e.g., `ticker` from SEC EDGAR
  beats `ticker` from NewsAPI scrape; configured via a small JSON table.
- **Reviewer UI** — surface conflicts at `/zippering/conflicts` for manual
  resolution. Once resolved, the decision feeds back into the priority table.

---

## 9. Migration from `external_signals`

Three-phase migration so we never have a flag day.

### Phase A: Dual-write
- Zipperer wraps existing adapters and writes to BOTH `external_signals`
  (legacy, hand-mapped schema) and `zippered_signals` (new).
- Reads still hit `external_signals`.
- Risk: 2x write volume on Supabase. Mitigation: only dual-write for one
  integration (newsletter) first; expand once stable.

### Phase B: Read migration
- New reads (`/account/[slug]`, `/market-intel` ticker, manager rollups)
  switch to `zippered_signals` via the wrapper functions.
- The `external_signals_compat` view keeps legacy callers working.
- Catch regressions via `verify-demo-scores.ts` + manual /exercise-app-features.

### Phase C: Decommission legacy
- Drop the `external_signals` writers from the adapters.
- Keep the `external_signals_compat` view indefinitely (it's free) for any
  external tools that hit the table directly.

---

## 10. Phased rollout

| Phase | Scope | Days | Ships |
| --- | --- | --- | --- |
| 0 | Schema (4 tables) + migration + RLS posture | 1 | Supabase migration only |
| 1 | Zipperer lib + Haiku prompt + tests | 2 | `src/lib/zippering.ts` + fixtures + unit tests |
| 2 | Wrap ONE adapter (newsletter) in dual-write | 2 | Behind feature flag; shadow reads validate |
| 3 | Migrate remaining 5 adapters (sec, newsapi, firecrawl, granola, web-scrape) | 3 | All sources zippered |
| 4 | Read path migration | 3 | UIs read from `zippered_signals`; compat view backs legacy callers |
| 5 | Conflict UI + reviewer surface | open-ended | `/zippering/conflicts` (value disagreements) + `/zippering/review` (unclear-decision promotion to join) + manual resolution flow |

Phase 0-3 is the path to "zippering is real and writing." Phase 4 is when it
becomes visible to operators. Phase 5 is the long tail of operator tooling.

---

## 11. Open questions

Worth resolving before Phase 1 starts:

1. **Schema scope.** Is the canonical schema **per pkey** (every account gets
   its own column universe) or **global** (one workspace-wide column universe,
   pkey just owns the values)? Per-pkey is more flexible; global is cheaper
   to query across accounts. Default in this plan: **per pkey**, on the bet
   that small accounts won't have many integrations and large accounts will
   want their own shape. Worth pushback.
2. **Type changes mid-stream.** What happens when source A writes
   `occurred_at` as a date string and source B writes it as an epoch ms?
   Option A: zipperer normalizes at write time using `data_type` from
   `zippering_schema`. Option B: store as-is, normalize at read. Plan
   recommends A but it adds a small parser layer.
3. **Explainability.** How does an operator answer "why did this signal map
   to `content`?" A `/zippering/decisions/<pkey>/<column>` debug endpoint
   surfaces the original Haiku verdict + reason. Cheap to add; worth it for
   trust.
4. **Operator override.** If Haiku gets a verdict wrong, can a human re-map?
   Add `decision_override_by` + `decision_override_at` columns to
   `zippering_decisions` + an admin UI. The most common case is promoting
   `unclear` verdicts to `join` (see §6 "Operator review of unclear
   decisions"); the same surface also handles correcting wrong `join`
   verdicts to `append` and vice versa. Backfill on promotion uses
   `jsonb_set` to rename keys inside `zippered_signals.columns`. Deferred
   to Phase 5 (UI); the columns + behavior are baked in from Phase 0.
5. **Multi-tenancy.** If we ever serve multiple Checkbox-style workspaces,
   all four tables need a `workspace_key` column. Cheap to add now (one
   migration); painful to retrofit later. Plan recommends adding it from
   Phase 0.

---

## 12. Success criteria

How we know zippering is working:

- A new integration (say HubSpot) can plug into the zipperer with ~20 lines
  of adapter code (`pkey`, `source`, raw row). No schema migration. Signals
  appear under the right pkey within minutes.
- `/account/[slug]` shows a unified timeline regardless of source.
- `/market-intel` ticker pulls from zippered data; per-account filtering
  works without joining 6 tables.
- Cost per new pkey stays under $0.05 average (well below the $0.022
  worst-case in §7).
- Operator can answer "where did this column come from?" in one click.
- ≥90% of decisions are confident (`similarity_score ≥ 0.8`); the unclear
  bucket stays small and reviewable.

---

## 13. What this replaces

The current static `external_signals` schema (single union table, hand-mapped
columns from each adapter at write time) becomes the legacy compat layer
during migration and is retired in Phase 5. The `unify-signals.ts` lib and
the per-adapter mappers become unnecessary — zippering subsumes them.

The pkey work landed in PRs #88, #89, #90, #92 is the prerequisite. AccountId
typing + accountsById Map + the `createAccountSeed` helper are all already in
place. Onboarding (`/onboard`, PR #93–#94) is how new pkeys enter the system.

Zippering is the next thing those pkeys carry weight for.

---

## 14. Open for review

Push back on anything in §3 (data model), §8 (conflict policy), §11.1 (per-pkey
vs global schema), or §10 (phasing). Those are the load-bearing choices; the
rest is mechanics.
