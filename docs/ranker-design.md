# Market Intel Ranker — design doc

> Author: design agent (Opus 4.7). Implementer: I-Rank.
> Scope: re-rank `/market-intel` for the active workspace using Haiku 4.5,
> caching to Supabase, with a deterministic stub fallback. **No code in this
> doc — implementer owns the diff.**
> Cross-checked against: `orgs/checkbox/BUILD_ALIGNMENT.md` (10 principles + #11),
> `orgs/checkbox/synthesis.md` (12 canonical signal_types), `AGENTS.md`
> (Next 16 caveats), session 8 dual-provider pattern.

---

## 0. Decisions already made (do not relitigate)

- Re-rank the existing `/market-intel` page; no new route.
- Workspace-wide ranking (not per-AE).
- Input: last 48h of `external_signals` for the workspace.
- Output: ordered top 20 (configurable), each `{signal_id, rank, rationale, related_account_ids?}`.
- Cache key: `(workspace_key, date_bucket=YYYY-MM-DD-HH)` — TTL 1h.
- Stub mode (no `ANTHROPIC_API_KEY`): deterministic sort.
- Fail-open on Haiku 5xx / malformed JSON → stub + yellow banner.
- Per BUILD_ALIGNMENT #6, every rationale carries its `signal_id`.

---

## 1. Files to create

| Path | Purpose |
|---|---|
| `src/lib/ranker-types.ts` | Pure type module: `RankerInput`, `RankedItem`, `RankerResult`, `CacheKey`, `CacheEntry`, `StubReason`. No imports beyond `ExternalSignal`. |
| `src/lib/ranker-system-prompt.ts` | Exports `getRankerSystemPrompt()` — the Haiku system prompt. Mirrors `ask-system-prompt.ts` pattern: one function, deterministic output, no state. |
| `src/lib/ranker-stub.ts` | Pure deterministic ranker. Sort comparator + slice to N. Exported `rankStub(input, reason): RankerResult`. No I/O. |
| `src/lib/ranker.ts` | Public entry: `rankSignals(input): Promise<RankerResult>`. Owns cache check, Haiku call, JSON validation, stub fallback. |
| `src/lib/ranker-cache.ts` | Supabase CRUD for `ranker_cache`. `getCachedRanking(key)`, `writeCachedRanking(key, result)`. Returns `null` on miss / read failure (fail-soft). |
| `src/lib/ranker.test.ts` | Vitest cases for `rankSignals` and `rankStub` (~12 cases — see §9). Mocks Anthropic + cache module. |
| `src/components/ranker-banner.tsx` | Client component (or inline server component — implementer's call). Renders the yellow "fallback" or "stub" banner when `result.stubReason` is set. |
| `supabase/migrations/20260524_ranker_cache.sql` | Creates `ranker_cache` table + RLS deny-all. **Must be run manually in Supabase Studio** (same posture as the other 3 migrations — see HANDOFF.md §8). |

**Total new files: 8.**

---

## 2. Files to modify

| Path | Change |
|---|---|
| `src/app/market-intel/page.tsx` | After the existing `getWorkspaceSignals(since, MAX_ITEMS)` call, narrow to the last 48h, call `rankSignals({workspaceKey, signals, accountKeywords, now})`, then render two tables: **"Ranked by relevance"** (top 20 with `rank`, `rationale`, citation chip) followed by the existing chronological table titled **"All signals (chronological)"**. Mount `<RankerBanner stubReason={result.stubReason} />` above the ranked table when set. |
| `src/lib/external-signals.ts` | No code change required. The ranker reads `ExternalSignal` rows as-is. **Optional follow-up (not in scope):** add a `derived_severity` column later if we ever wire signal_type → severity tier mapping at write time. |

That's it — two files modified. The ranker module is additive.

---

## 3. Types

All new types live in `src/lib/ranker-types.ts`. They extend `ExternalSignal` by reference, never duplicate fields.

```ts
import type { ExternalSignal, ExternalSignalType } from "./external-signals";

// What the ranker receives. Workspace-scoped, time-windowed.
export interface RankerInput {
  workspaceKey: string;            // slug of WorkspaceConfig.companyName
  signals: ExternalSignal[];       // last-48h workspace signals (pre-filtered)
  accountKeywords: AccountKeyword[]; // for relevance-fan-in; cheap match hints
  topN?: number;                   // default 20; cap 50
  now: Date;                       // pass-in for testability (no Date.now in core)
}

// Tracked-account context. The ranker uses this to recognize when a signal
// references one of the workspace's named accounts. Cheap subset of Account.
export interface AccountKeyword {
  account_id: string;              // e.g. "acc_helios"
  name: string;                    // "Helios Manufacturing"
  ticker?: string;                 // "HLOS"
  domain_slug?: string;            // "helios" (from website host)
}

// One ranked item. Does NOT carry the full ExternalSignal; consumers join by
// signal_id. Keeps cache payload small.
export interface RankedItem {
  signal_id: string;               // → ExternalSignal.id
  rank: number;                    // 1..topN, dense, no gaps
  rationale: string;               // ≤25 words, plain prose, must include
                                   //   "[citation:<signal_id>]" inline
  related_account_ids?: string[];  // optional; matches AccountKeyword.account_id
}

// Wrapper returned by rankSignals().
export interface RankerResult {
  items: RankedItem[];             // length ≤ topN; may be []
  generated_at: string;            // ISO; for cache-age UI hint
  source: "haiku" | "stub";        // which path produced this
  stubReason?: StubReason;         // set only when source === "stub"
  cache_hit: boolean;              // for log/debug; not displayed
}

// Why the ranker degraded to deterministic.
export type StubReason =
  | "no_api_key"                   // ANTHROPIC_API_KEY missing
  | "haiku_5xx"                    // any 5xx from Anthropic
  | "haiku_timeout"                // request exceeded 15s wall clock
  | "haiku_malformed_json"         // parser couldn't validate response
  | "haiku_schema_violation"       // valid JSON, failed our schema (>20, missing field, bad signal_id)
  | "empty_input";                 // signals: [] — short-circuit to empty result

// Cache key composition — deterministic, no Date.now inside the type.
export interface CacheKey {
  workspace_key: string;           // slugified workspace name
  date_bucket: string;             // formatToHourBucket(now) → "2026-05-23-17"
}

// Cache row as stored in Supabase.
export interface CacheEntry {
  workspace_key: string;           // primary key part 1
  date_bucket: string;             // primary key part 2
  result_json: RankerResult;       // serialized RankerResult
  created_at: string;              // ISO; ranker treats >1h as expired
}
```

**Why no field duplication:** `RankedItem` carries only `signal_id`. The
page already has the full `ExternalSignal[]` from the existing fetch and
joins client-side. Cache stays small; refactors to `ExternalSignal` don't
cascade into the ranker.

---

## 4. Prompt design

### System prompt — ready to paste

`src/lib/ranker-system-prompt.ts` exports `getRankerSystemPrompt(args: { workspaceContext: string; topN: number }): string`. Full text below (`{topN}` and `{workspaceContext}` are template holes):

```
You rank market-intel signals for a B2B sales team using Dugout, a unified
sales intelligence layer. Your output orders the most relevant items first,
each with a one-sentence rationale tied to a specific signal id.

# What you are looking at
The user message will contain a JSON array of `signals`. Each signal has:
  - id (string, the citation key — never alter)
  - source (one of: "newsapi" | "sec_edgar" | "newsletter" | "web_scrape" | "manual" | "demo")
  - type (the legacy 12-value newsletter taxonomy — see below)
  - summary (≤500 chars of factual prose)
  - occurred_at (ISO timestamp)
  - mention (account/entity name as it appeared in the source, or null)

You will also receive `accountKeywords` — the list of accounts this workspace
tracks. Treat a signal as account-relevant when its `mention` or `summary`
unambiguously names one of these accounts (by name, ticker, or domain slug).

# Legacy signal_type values you will see in the data
The market-intel feed pre-dates Dugout's canonical taxonomy. You will see
these 12 newsletter-era types — use them as-is, do not invent new ones:

  leadership_change, champion_job_change, ma_acquisition, funding_round,
  layoff, earnings, product_launch, press_release, competitor_mention,
  regulatory_action, partnership, other

# Dugout's canonical taxonomy (use only for rationale wording)
When you write a rationale, you may reference Dugout's 12 canonical signal
categories where they help an AE pattern-match. These are the ONLY 12 — do
not invent a 13th:

  champion_loss, champion_disengagement, committee_gap, committee_expansion,
  momentum_change, competitive_threat, shadow_research,
  account_health_decline, lifecycle_milestone, account_context,
  vertical_context, data_hygiene_gap

# Ranking rubric — apply in this order
1. **Account-named items first.** A signal whose mention/summary names one
   of `accountKeywords` outranks any non-named signal — full stop. Within
   account-named, prefer signals that imply a deal-stage event
   (leadership_change, ma_acquisition, layoff, funding_round, earnings,
   regulatory_action) over neutral context (press_release, product_launch).
2. **Severity by type.** Among non-named signals, prefer types that map to
   blocking-tier canonical categories (leadership_change → champion_loss;
   ma_acquisition → account_context BLOCKING; layoff → account_health_decline;
   regulatory_action → vertical_context elevated). Then action-tier
   (funding_round, earnings, competitor_mention, partnership). Then awareness
   (product_launch, press_release, other).
3. **Recency last.** All else equal, newer wins.
4. **Diversity tiebreaker.** Avoid stacking 5 items about the same `mention`
   in the top 10 — prefer one per entity in the upper half.

# Hard constraints
- Output AT MOST {topN} items. Fewer is fine if input is small.
- `rank` is a dense 1-based sequence; no gaps, no ties.
- `rationale` is ≤25 words, plain prose, ONE sentence, no markdown, no
  emoji, no exclamation marks. Match Dugout's voice (BUILD_ALIGNMENT #8).
- `rationale` MUST contain "[citation:<signal_id>]" exactly once, where
  <signal_id> is the same id you put in the `signal_id` field. This enforces
  BUILD_ALIGNMENT #6 (evidence chain). A rationale without a citation is a
  schema violation.
- `signal_id` must be one of the ids in the input. You may not invent ids.
  This is BUILD_ALIGNMENT #6 (no claim without a citation) and the schema
  validator will reject otherwise.
- `related_account_ids[]` is optional. When present, each entry must be an
  `account_id` from `accountKeywords`. Do not invent account ids.
- Do not invent or paraphrase facts. The rationale must be supported by the
  signal's own summary.
- Do not include rationale text that recommends an action ("the AE should
  call X"). This is a read-only ranker (BUILD_ALIGNMENT #9). Describe, do
  not prescribe.

# Workspace context
{workspaceContext}

# Output format (tool-use, mandatory)
You MUST emit your answer via the `submit_ranking` tool. Free-text replies
will be rejected. The tool's input schema is enforced; emit JSON that
satisfies it on the first try.
```

### Tool / structured output schema

The ranker uses Anthropic's tool-use (same shape as `ask-tools.ts`), exposing one tool the model is forced to call:

```json
{
  "name": "submit_ranking",
  "description": "Submit the ranked list. Call this exactly once with the final ordering.",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["items"],
    "properties": {
      "items": {
        "type": "array",
        "minItems": 0,
        "maxItems": 20,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["signal_id", "rank", "rationale"],
          "properties": {
            "signal_id": { "type": "string", "minLength": 1 },
            "rank":      { "type": "integer", "minimum": 1, "maximum": 20 },
            "rationale": { "type": "string", "minLength": 10, "maxLength": 220 },
            "related_account_ids": {
              "type": "array",
              "items": { "type": "string", "minLength": 1 },
              "maxItems": 5
            }
          }
        }
      }
    }
  }
}
```

`maxItems: 20` is the JSON-schema enforcement of the topN cap. The wrapper
ALSO post-validates: every `signal_id` must exist in input; every rationale
must regex-match `\[citation:([^\]\s]+)\]` and the captured id must equal
`signal_id`. Failing either → `StubReason = "haiku_schema_violation"`.

`topN` is enforced in TWO places (schema's `maxItems` + post-validation length check) because Anthropic occasionally returns 21+ items despite the schema; defensive on both sides costs nothing.

### User message template

```
Workspace: {workspace_name}
Now (UTC): {iso_now}
Lookback: 48h

Tracked accounts ({account_count}):
{json_accountKeywords}

Signals to rank ({signal_count}):
{json_signals_minified}
```

Signals payload is minified to `[{id, source, type, summary, occurred_at, mention}]` — drop `meta`/`url`/`is_demo`/`created_at` from the wire to save tokens. The page still has the full row for rendering.

### Which BUILD_ALIGNMENT principles the prompt enforces

- **#2 (Canonical signal_types only)** — enumerates the 12 canonical types AND the 12 legacy `ExternalSignalType` values so the model never invents a 13th.
- **#3 (Severity = 3 tiers)** — rubric maps to blocking / action / awareness without ever using other words.
- **#6 (Evidence chain mandatory)** — `signal_id` field + inline `[citation:...]` rule + post-validator + schema rejection of invented ids.
- **#8 (Voice)** — explicit "no markdown, no emoji, no exclamation, ≤25 words, one sentence, plain".
- **#9 (Read-only v1)** — "describe, do not prescribe."

---

## 5. Data flow

```
GET /market-intel
  → MarketIntelPage() (server component, force-dynamic)
    → const since = now - 48h.toISOString()
    → const signals = await getWorkspaceSignals(since, MAX_ITEMS)     // existing
    → const cfg     = await getWorkspaceConfig()                      // existing
    → const accountKeywords = buildAccountKeywords(seedAccounts, cfg) // new helper
                                                                       // (slug name/ticker/domain)
    → const result  = await rankSignals({
          workspaceKey: slugify(cfg.companyName),
          signals,
          accountKeywords,
          now,
        })
        │
        ├─ short-circuit: signals.length === 0 → returns empty RankerResult{source:"stub", stubReason:"empty_input"}
        │
        ├─ key = { workspace_key, date_bucket: formatHourBucket(now) }
        ├─ cached = await getCachedRanking(key)
        │   └─ if cached && age < 1h → return {...cached, cache_hit: true}
        │
        ├─ if !HAS_ANTHROPIC_KEY → return rankStub(input, "no_api_key")
        │
        ├─ try {
        │     callHaiku(systemPrompt, userPayload, tool_choice="submit_ranking", timeout=15s)
        │     parse + post-validate (every signal_id in input, citation present, len≤topN)
        │     result = { items, source: "haiku", generated_at, cache_hit: false }
        │  } catch (e) {
        │     classify(e) → StubReason
        │     return rankStub(input, reason)
        │  }
        │
        ├─ writeCachedRanking(key, result)            // best-effort; log + swallow on failure
        └─ return result

    → render:
       <RankerBanner stubReason={result.stubReason} />   // yellow if set, else null
       <RankedTable signals={signals} items={result.items} />
       <ChronologicalTable signals={signals} />           // existing, renamed heading
```

### Account-context fan-in

The ranker needs to know which accounts the workspace tracks so a signal that
names one of them outranks generic vertical noise. Today there's no
`workspaces.accounts` join — the workspace is cookie-backed and accounts live
in `src/data/seed.ts`. The page builds `AccountKeyword[]` from `accounts`
(same shape `newsletter-adapter.ts:accountKeywords()` uses) and passes it
into the ranker. When real per-workspace account scoping lands later, swap
the source — the ranker contract doesn't change.

---

## 6. Caching

### Decision: **Supabase table `ranker_cache`**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Supabase `ranker_cache`** | Survives lambda cold starts; visible in Studio; one source of truth across all 3 Vercel regions; same posture as `ask_request_log` + `web_scrapes` | Adds a migration; 1 round-trip per page load on miss | **Chosen.** |
| In-memory module map | Zero infra | Lost on every cold start (Vercel functions are ephemeral); per-region cache fragmentation; useless for the 1h TTL | Rejected. |
| localStorage | Free; per-user | Per-browser, not per-workspace; can't drive server-rendered page; collides with multi-device | Rejected. |

The Supabase option is symmetrical with the rest of the codebase — every
other "remember this between requests" surface (ask rate log, web scrapes,
inbound emails) lives in Postgres. Cost is negligible (1 row/workspace/hour).

### Schema

```sql
-- supabase/migrations/20260524_ranker_cache.sql
-- Market-intel ranker cache. One row per (workspace, hour bucket). The
-- ranker rebuilds the bucket key on every request; reads with age >1h are
-- treated as miss and overwritten. No background invalidation job needed.
--
-- workspace_key is the slugified workspace name (cookie-backed today; will
-- become a real workspaces.id later). date_bucket is YYYY-MM-DD-HH (UTC).
--
-- Run manually in Supabase Studio (SQL Editor → New query) or via
-- `supabase migration up`.

create table if not exists ranker_cache (
  workspace_key  text         not null,
  date_bucket    text         not null,
  result_json    jsonb        not null,
  created_at     timestamptz  not null default now(),
  primary key (workspace_key, date_bucket)
);

-- Hot path: lookup by exact key. The primary key index serves this; no
-- secondary index needed. Add one only if a future use case queries by
-- created_at independently.

-- Optional housekeeping: a daily cron can prune buckets older than 7 days
-- to keep the table small. NOT scheduled in v1 — the table is tiny.

-- RLS deny-all. Matches the session-7 RLS posture and the ask_request_log
-- migration. Service role bypasses RLS, so the app keeps working.
alter table ranker_cache enable row level security;
```

### Invalidation: **pure TTL, no event-driven invalidation**

- **TTL = 1 hour.** Reads with `now - created_at > 1h` are treated as miss; the next call overwrites the row.
- **Why not invalidate on new signal write:** the ingestion path is
  multi-source (NewsAPI cron daily, SEC daily, AgentMail webhook on receipt,
  Firecrawl daily) and adding cache-bust hooks to all four is more code
  than the freshness payoff justifies. A 1h staleness window is fine for a
  human-paced "market intel browser" use case. If a customer ever asks for
  near-real-time ranking, add a `DELETE` call from the inbound-pipeline
  classifier — single line, no schema change.
- **Cache write is best-effort.** A Supabase write failure logs a warning
  and returns the in-memory result. The next request will simply recompute.

### Cache key composition (testable in isolation)

```ts
function buildCacheKey(workspaceName: string, now: Date): CacheKey {
  return {
    workspace_key: slugify(workspaceName),                 // "Checkbox" → "checkbox"
    date_bucket: formatHourBucketUTC(now),                  // "2026-05-23-17"
  };
}
// slugify: lowercase, strip non-alnum, collapse to "-". Pure.
// formatHourBucketUTC: ISO YYYY-MM-DD-HH in UTC. Pure.
```

Both helpers ship in `ranker-cache.ts` and are exported for the test file.

---

## 7. Stub mode

The deterministic ranker is a pure function — no I/O, no clock, no random.
Lives in `src/lib/ranker-stub.ts`.

### Pseudocode

```
function rankStub(input: RankerInput, reason: StubReason): RankerResult {
  if (input.signals.length === 0) {
    return { items: [], generated_at: input.now.toISOString(),
             source: "stub", stubReason: "empty_input", cache_hit: false };
  }

  // Precompute severity tier and account-relevance per signal — once.
  const enriched = input.signals.map(s => ({
    signal: s,
    severityRank: severityTierFor(s.type),     // 0 blocking | 1 action | 2 awareness
    accountIds:   matchAccounts(s, input.accountKeywords),
    occurredMs:   Date.parse(s.occurred_at),
  }));

  // Primary sort — see comparator below.
  enriched.sort(compareEnriched);

  const topN = clamp(input.topN ?? 20, 1, 50);
  const sliced = enriched.slice(0, topN);

  return {
    items: sliced.map((e, i) => ({
      signal_id: e.signal.id,
      rank:      i + 1,
      rationale: stubRationale(e),  // see below; always cites e.signal.id
      related_account_ids: e.accountIds.length > 0 ? e.accountIds : undefined,
    })),
    generated_at: input.now.toISOString(),
    source: "stub",
    stubReason: reason,
    cache_hit: false,
  };
}
```

### Sort comparator (exact)

Account-relevance is a **tiebreaker among severity peers**, not a primary key
— Jackson's brief is explicit on this. The comparator order is therefore:

```
compareEnriched(a, b):
  // 1. severity_tier asc  (blocking=0 first)
  if (a.severityRank !== b.severityRank) return a.severityRank - b.severityRank;

  // 2. account-named first within the same severity tier
  const aNamed = a.accountIds.length > 0 ? 0 : 1;
  const bNamed = b.accountIds.length > 0 ? 0 : 1;
  if (aNamed !== bNamed) return aNamed - bNamed;

  // 3. created_at desc (occurred_at desc — newer first)
  if (a.occurredMs !== b.occurredMs) return b.occurredMs - a.occurredMs;

  // 4. signal_type alpha (final deterministic tiebreaker)
  return a.signal.type.localeCompare(b.signal.type);
}
```

**Severity tier mapping** (deterministic, no model in the loop):

| ExternalSignalType | Tier |
|---|---|
| `leadership_change`, `champion_job_change`, `ma_acquisition`, `layoff`, `regulatory_action` | **blocking (0)** |
| `funding_round`, `earnings`, `competitor_mention`, `partnership` | **action (1)** |
| `product_launch`, `press_release`, `other` | **awareness (2)** |

### `stubRationale(e)`

Templated, always cites the signal id. Examples:

- Account-named, blocking: `"Names {accountName}; {type} is a blocking-tier deal-stage event. [citation:{id}]"`
- Account-named, action: `"Names {accountName}; {type} warrants follow-up. [citation:{id}]"`
- Unnamed, blocking: `"Vertical-level {type} worth scanning for adjacent accounts. [citation:{id}]"`
- Unnamed, awareness: `"Background context; flagged for awareness. [citation:{id}]"`

Each ≤25 words, one sentence, `[citation:...]` present, no exclamation.

---

## 8. Failure modes

| Condition | Behavior | UI signal | Log line |
|---|---|---|---|
| `ANTHROPIC_API_KEY` missing | Stub with `no_api_key`; cache write skipped | Yellow banner: "Live ranking unavailable — showing deterministic fallback" | `[ranker] no_api_key — stub serving ${n} items` |
| Haiku 5xx (any 5xx, after SDK retries) | Stub with `haiku_5xx`; cache write skipped | Yellow banner (same copy) | `[ranker] haiku_5xx status=${status} — stub serving ${n} items` |
| Haiku timeout (>15s wall clock) | Stub with `haiku_timeout`; cache write skipped | Yellow banner | `[ranker] haiku_timeout after 15s — stub` |
| Malformed JSON (tool-use returned but unparseable) | Stub with `haiku_malformed_json`; cache write skipped | Yellow banner | `[ranker] haiku_malformed_json: ${err.message}` |
| Schema violation (>20 items, invented signal_id, missing citation, citation id ≠ signal_id) | Stub with `haiku_schema_violation`; cache write skipped | Yellow banner | `[ranker] haiku_schema_violation: ${reason}` |
| Empty signals (`signals.length === 0`) | Return empty `RankerResult` with `source:"stub"` + `stubReason:"empty_input"`; no Haiku call, no cache write | No banner. The page already renders its empty state. | `[ranker] empty_input — short-circuit` |
| Cache READ failure (Supabase 5xx) | Treat as miss; proceed to Haiku/stub path; do NOT surface to UI | No banner | `[ranker] cache_read_failed: ${err.message}` |
| Cache WRITE failure | Return computed result anyway; do NOT surface to UI | No banner | `[ranker] cache_write_failed: ${err.message}` |
| Stale cache (age > 1h) | Treat as miss; recompute; overwrite row | No banner (transparent refresh) | `[ranker] cache_stale age=${ageMin}m — recompute` |
| `signals.length` between 1 and ~3 | Run normal Haiku path. The model may return fewer items than topN — that's valid. | Normal | n/a |

Wrap the entire `rankSignals` body in a try/catch as a final safety net: any
unhandled error → `rankStub(input, "haiku_schema_violation")` with a
warning log. The market-intel page must never 500 on a ranker bug.

---

## 9. Test plan

`src/lib/ranker.test.ts`. Mock the Anthropic SDK + `ranker-cache` module.
12 cases:

1. **`stub_is_deterministic`** — same input → identical output across 100 runs. Asserts sort stability.
2. **`severity_tier_sort_order`** — input of 3 signals (`product_launch`, `leadership_change`, `funding_round`). Output rank order = `leadership_change, funding_round, product_launch`.
3. **`account_relevance_is_tiebreaker_not_primary`** — input: `[product_launch mentioning acc_helios, leadership_change unnamed]`. Output rank 1 = `leadership_change` (blocking outranks awareness even when awareness is account-named). Locks in §7 comparator order.
4. **`account_named_wins_within_same_tier`** — input: two `funding_round` signals, one mentions `acc_helios`. Account-named ranks first.
5. **`malformed_haiku_response_triggers_stub`** — mock returns non-JSON text. Result `source === "stub"`, `stubReason === "haiku_malformed_json"`, items array still populated from stub.
6. **`empty_signals_returns_empty_result_not_error`** — `signals: []`. Result `{items: [], source: "stub", stubReason: "empty_input"}`. No throw. No Haiku call (mock asserts `mockHaiku.mock.calls.length === 0`).
7. **`cache_key_composition`** — `buildCacheKey("Checkbox", new Date("2026-05-23T17:42:00Z"))` → `{workspace_key: "checkbox", date_bucket: "2026-05-23-17"}`. Hour bucket truncates minutes; UTC, not local.
8. **`citation_present_in_every_rationale`** — for both stub output and a mocked-valid Haiku output, every `items[i].rationale` matches `\[citation:([^\]\s]+)\]` AND the captured id equals `items[i].signal_id`.
9. **`schema_rejects_more_than_20_items`** — mock Haiku returns 21 items. Result `source === "stub"`, `stubReason === "haiku_schema_violation"`.
10. **`schema_rejects_invented_signal_id`** — mock Haiku returns one item whose `signal_id` doesn't appear in input. Falls back to stub with `haiku_schema_violation`.
11. **`prompt_enumerates_all_12_legacy_external_types`** — `getRankerSystemPrompt({...})` string contains all 12 `ExternalSignalType` literals AND all 12 canonical signal_types from BUILD_ALIGNMENT #2. Guards against drift if either taxonomy changes.
12. **`cache_hit_skips_haiku`** — mock `getCachedRanking` returns a fresh entry. Result `cache_hit === true`. Anthropic mock asserts zero calls.

Bonus 13 (optional): **`stub_rationale_word_cap`** — every stub rationale ≤25 words. Cheap, catches drift on the template strings.

Run target: `npm test` passes 113 + 12 = 125 tests (or 13 = 126 with bonus).

---

## 10. BUILD_ALIGNMENT cross-check

Walked principle-by-principle. The file is `orgs/checkbox/BUILD_ALIGNMENT.md`.

1. **Schema fidelity** — **Satisfied.** `ranker_cache` is a new admin/intel-adjacent table; field names (`workspace_key`, `date_bucket`, `result_json`, `created_at`) follow the project's snake_case convention. No `signal_instances` or `signal_correlations` fields are touched.
2. **Canonical signal_type only** — **Satisfied with a note.** The ranker reads `ExternalSignal.type` which uses the legacy 12-value newsletter taxonomy (pre-dates the canonical 12). The prompt enumerates BOTH the legacy types (what the model sees) and the canonical 12 (allowed in rationale prose). No new signal type is invented.
3. **Severity = 3 tiers** — **Satisfied.** Stub uses `blocking | action | awareness` (mapped from `ExternalSignalType`). Prompt rubric uses the same three words.
4. **Direction required** — **Gap (intentional).** `ExternalSignal` predates the `direction` field — it's not on the table. The ranker doesn't emit signals, only ranks existing ones, so this principle doesn't apply at the ranker layer. Note this in the implementer's PR description.
5. **No per-signal confidence** — **Satisfied.** `RankedItem` has no `confidence` field. Multi-source count isn't in scope (single-source by design — these are external signals).
6. **Evidence chain mandatory** — **Satisfied (and centrally enforced).** Every `RankedItem.rationale` must contain `[citation:<signal_id>]`. Post-validator rejects responses that miss it. Stub templates hardcode the citation.
7. **No direct DB access from UI** — **Satisfied.** `src/app/market-intel/page.tsx` is a server component; it calls `rankSignals()` (a `src/lib/*` helper), which calls `getCachedRanking()` (another `src/lib/*` helper). UI never imports `@/lib/supabase` directly.
8. **Voice** — **Satisfied.** Prompt explicitly bans exclamation marks, emoji, markdown, and limits to one sentence ≤25 words. Stub templates follow the same rules.
9. **Read-only v1** — **Satisfied.** Ranker writes only to `ranker_cache` (Dugout's own DB). Prompt explicitly bans prescriptive rationale ("describe, do not prescribe"). No source-system writes.
10. **Demo data only** — **Satisfied.** No new keys, no PII added. `ranker_cache.result_json` stores `signal_id` references, not personal data.
11. **AI provider neutrality** — **Gap (intentional, justified).** The ranker is Anthropic-only (Haiku 4.5), no user-facing picker, no dual schema. Principle #11's own text carves this out: *"The other AI surfaces stay model-specific. Morning digest stays on Sonnet 4.6; inbound-email classifier stays on Haiku 4.5. Those are single-shot prompts with stable cost where provider choice doesn't earn its keep."* The ranker is exactly that pattern — single-shot, stable cost, no chat. **Implementer should mirror the digest/classifier wording in the PR description so the next AD-style alignment review doesn't re-flag it.**

---

## 11. Open questions for the implementer

Things I left ambiguous on purpose — I-Rank picks:

1. **Where to slugify the workspace name.** `src/lib/workspace.ts` doesn't currently export a `workspaceKey()` helper. Two options: (a) add one to `workspace.ts`, (b) do it inline in `market-intel/page.tsx`. I'd pick (a) so the future `ask-rate-limit` integration can share it, but it's two lines either way.
2. **Page placement of the chronological table.** I specified "ranked above chronological." If the ranked block is empty (stub + empty input), do we hide the divider or keep it? I'd hide and show only chronological — but it's a UX call.
3. **Whether to background-warm the cache.** A Vercel cron at top-of-hour could pre-rank for the default workspace so the first human request is always a cache hit. Worth doing only if cold-render latency proves to be a demo problem; defer to user observation.
4. **`AccountKeyword.domain_slug` source.** I assumed `account.website` exists on the seed type. If it doesn't, the helper falls back to `name`-only matching — slightly less precise. Implementer confirms by reading `src/lib/types.ts`.
5. **Banner color literal.** "Yellow" per the brief — match the existing `/ask` 429 amber card (`ask-chat-panel.tsx`) for visual consistency, or pick a distinct yellow to differentiate "ranker degraded" from "rate-limited." I'd reuse amber.
6. **Topology of `topN`.** I exposed it on `RankerInput` (default 20, cap 50). It's not surfaced in the UI in v1. Should it be a query-string override (`/market-intel?top=30`) for the demo? Punt to v1.1.
7. **Should `RankerResult.items` length ever exceed `signals.length`?** Obviously not — but Haiku might. The post-validator should reject. Implementer chooses whether that's a separate `StubReason` or rolls into `haiku_schema_violation`. I'd roll it in.

---

## 12. Estimated diff

| Metric | Estimate |
|---|---|
| Files created | **8** (7 src + 1 migration) |
| Files modified | **2** (`market-intel/page.tsx`, optionally `workspace.ts` for the slug helper) |
| Net LOC added | **~750** (types ~80, system prompt ~140, stub ~120, ranker ~180, cache ~80, banner ~40, page edits ~50, migration ~30, tests ~430 — yes, tests dominate by design) |
| Test cases added | **12** (or 13 with bonus); brings `npm test` total to **125–126**. |
| Migrations to run manually | **1** (`20260524_ranker_cache.sql` in Supabase Studio) |
| Env vars added | **0** (reuses existing `ANTHROPIC_API_KEY` + `SUPABASE_*`) |
| Time estimate (I-Rank single agent) | **~4 hours** including the test suite + a smoke run against real Supabase + screenshot for the PR |

PR title suggestion: `feat(market-intel): Haiku-ranked workspace intel with deterministic fallback`.

---

## 13. Pre-merge alignment checklist (for the AD-style review agent)

- [ ] `npm test` passes (125+ cases).
- [ ] `npm run lint`, `npx tsc --noEmit`, `npm run build` all clean.
- [ ] System prompt enumerates all 12 legacy `ExternalSignalType` values AND all 12 canonical signal_types.
- [ ] Every rationale (stub + happy-path mock) contains `[citation:<signal_id>]` with id matching `signal_id`.
- [ ] Migration runs cleanly in Supabase Studio; `ranker_cache` shows up in the Tables list with RLS enabled.
- [ ] Yellow banner renders on `/market-intel` when `ANTHROPIC_API_KEY` is intentionally unset locally.
- [ ] Cache miss → Haiku call → cache write → second request is `cache_hit: true` (verify via server log).
- [ ] `BUILD_ALIGNMENT.md` principles 1-11 walked; principle #4 and #11 gaps are documented in the PR description as intentional.
- [ ] `HANDOFF.md` §11 (Supabase RLS posture) is honored — the new migration includes the `enable row level security` one-liner.
