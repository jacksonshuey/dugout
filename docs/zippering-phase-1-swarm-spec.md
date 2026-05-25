# Zippering Phase 1 — Swarm build spec

> **Audience:** The coordinator of a `/swarm-task` run that will build the
> zipperer lib + Haiku prompt + explainability surface. This spec is the
> per-worker contract — claims, briefs, acceptance criteria, branch
> names. The conceptual design lives in
> [`docs/zippering-plan.md`](./zippering-plan.md); the file-by-file
> scaffolds live in
> [`docs/zippering-phase-1-handoff.md`](./zippering-phase-1-handoff.md).
> Workers read the brief from this spec PLUS their own file's scaffold
> from the handoff doc.

Last updated: 2026-05-25 · Phase 0 prerequisite: PR #100 (`1b63ee9`) on
main; Supabase migration may or may not be live yet (workers must NOT
assume live DB — see §8).

---

## 1. Goal

End-state: `src/lib/zippering.ts:zipperUpsert(row)` is callable. Given a
synthetic Granola-shaped row, it:

1. Looks up cached decisions for `(workspace_key, pkey, source, source_column)` triples
2. Calls Haiku for new triples to decide JOIN / APPEND / UNCLEAR
3. Normalizes values to the canonical's `data_type` (or flips to needs_review on unsafe coercion)
4. Writes the wide row to `zippered_signals` (idempotent on `(source, external_id)`)
5. Appends every decision to `zippering_decisions` for audit

Plus `/api/zippering/explain` + `/zippering/explain` page surface the
full decision history for any `(pkey, canonical_name)` slice.

## 2. Success criteria

- All 5 workers' PRs merged to main
- `npx tsc --noEmit` exits 0
- `npm run lint --silent` exits 0
- `npx vitest run` shows ~28-32 new passing tests (per-worker counts in §5)
- `npx tsx scripts/verify-demo-scores.ts` exits 0 (nothing in seed broke)
- Manual smoke: `curl /api/zippering/explain?pkey=acc_sap&canonical=company_name` returns 200 with `decisions: []` (no decisions made yet)

## 3. Non-goals (deliberate)

- **Do not migrate any existing adapter** (newsletter, sec_edgar, granola, etc.) to call `zipperUpsert`. That's Phase 2.
- **Do not write to `external_signals`** from the new code path.
- **Do not build the operator review UI** (`/zippering/review`). That's Phase 5.
- **Do not modify the seed accounts** or any `external_signals` writers.
- **Do not run the Phase 0 migration as part of any worker's PR.** The migration is on disk (PR #100); execution is gated on the user.

## 4. Layered structure

```
Layer 1 — Type contract (1 worker, ~30 min)
  └─ L1A: zippering-types.ts

Layer 2 — Pure libs that depend only on types (2 workers parallel, ~45 min each)
  ├─ L2A: zippering-coercions + test
  └─ L2B: zippering-haiku + test

Layer 3 — Ingest engine (1 worker, ~90 min)
  └─ L3A: zippering.ts + test (depends on L1A + L2A + L2B + supabaseAdmin)

Layer 4 — Explainability surface (1 worker, ~45 min)
  └─ L4A: api/zippering/explain route + zippering/explain page (depends on L3A read helpers)
```

**Layer execution rule:** each layer's PRs merge before the next layer's
workers spawn. Coordinator re-fetches origin between layers per
`/swarm-task` Phase 6 discipline.

**Total wall-clock:** ~3.5 hours with parallelism in L2. Without parallelism
(if you decide to run inline): ~4-5 hours.

---

## 5. Per-worker contracts

Every worker brief below should be injected verbatim into the
`/swarm-task` worker prompt template. Each contract includes file claims,
branch name, definition of done, and explicit acceptance criteria.

---

### Worker L1A — Zippering type contract

```yaml
worker_id: L1A
title: Zippering type contract
layer: 1
depends_on: []
branch: swarm/zippering/l1a-types
file_claims:
  - src/lib/zippering-types.ts
estimated_lines: 80
estimated_minutes: 30
```

**Brief:** Build the single TypeScript module that holds every shape the
zippering system uses. No runtime code, no tests — just types. Other
workers import from here.

**Definition of done:**
- `src/lib/zippering-types.ts` exists with the exports listed below
- `import` from `./types` works (imports `AccountId`)
- `npx tsc --noEmit` exits 0

**Required exports** (per
[handoff §3.2](./zippering-phase-1-handoff.md#32-file-1--srclibzippering-typests)):
- `ZipperingDataType` — union of `"text" | "integer" | "numeric" | "boolean" | "timestamp" | "jsonb" | "string[]"`
- `ZipperingVerdict` — union of `"join" | "append" | "unclear"`
- `GlobalCanonicalColumn` — interface matching the SQL columns
- `ZipperingSchemaRow` — interface matching the SQL columns
- `ZipperingDecisionRow` — interface matching the SQL columns
- `ZipperedSignalRow` — interface matching the SQL columns
- `IngestRow` — input shape for `zipperUpsert`
- `IngestValue` — per-column value + source metadata
- `HaikuRoutingVerdict` — Haiku's JSON output shape

**Acceptance criteria:**
- File exists, tsc clean
- Every interface mirrors the column names + types from `supabase/migrations/20260525_zippering_tables.sql` exactly (worker should read the migration file to confirm)
- `AccountId` is imported from `./types` (not re-defined here)
- No `any`. Optional fields use `| null` for SQL nullable, `?:` for input shapes only

**Self-check before commit:**
```bash
git diff --cached --name-only
# Must list ONLY: src/lib/zippering-types.ts
npx tsc --noEmit
```

**PR title:** `feat(zippering): L1A — type contract for the zipperer`

---

### Worker L2A — Coercion registry

```yaml
worker_id: L2A
title: Write-time type coercion registry
layer: 2
depends_on: [L1A merged]
branch: swarm/zippering/l2a-coercions
file_claims:
  - src/lib/zippering-coercions.ts
  - src/lib/zippering-coercions.test.ts
estimated_lines: 120
estimated_minutes: 45
```

**Brief:** Build the small registry of safe type coercers that the
zipperer calls at write-time. Per
[plan §4b](./zippering-plan.md#4b-write-time-normalization) and
[handoff §3.3](./zippering-phase-1-handoff.md#33-file-2--srclibzippering-coercionsts--test).

**Definition of done:**
- `src/lib/zippering-coercions.ts` exports `UnsafeCoercion` class and `normalize()` function
- `src/lib/zippering-coercions.test.ts` covers identity passes + every registered coercion + unsafe failures
- `npx vitest run src/lib/zippering-coercions.test.ts` shows ~10 passing tests

**Required behavior:**
- `normalize(value, from, to)`:
  - When `from === to`: returns `value` unchanged
  - When a coercer exists for `${from}→${to}`: returns the coerced value
  - When no coercer exists OR the coercer throws: throws `UnsafeCoercion`
- Coercers MUST include (minimum):
  - `integer→text`, `numeric→text`
  - `text→integer` (parse, throw on NaN)
  - `integer→timestamp` (epoch ms → ISO string)
  - `timestamp→integer` (ISO string → epoch ms)
  - `text→timestamp` (parse, throw on invalid Date)
  - `text→string[]` (single-element array)
  - `string[]→jsonb` (passthrough)
  - `text→jsonb` (passthrough)

**Required tests** (~10):
- Identity: `normalize("foo", "text", "text") === "foo"`
- Each registered coercer's happy path
- `text→integer` happy + NaN throws `UnsafeCoercion`
- `text→timestamp` happy + invalid throws
- Unregistered pair throws `UnsafeCoercion` (e.g. `boolean→string[]`)

**Acceptance criteria:**
- tsc + lint clean
- All vitest cases green
- No external dependencies (this is pure local logic)
- Imports only from `./zippering-types`

**Self-check before commit:**
```bash
git diff --cached --name-only
# Must list ONLY the two files above
npx tsc --noEmit && npx vitest run src/lib/zippering-coercions.test.ts
```

**PR title:** `feat(zippering): L2A — write-time coercion registry`

---

### Worker L2B — Haiku routing assessor

```yaml
worker_id: L2B
title: Haiku column-routing assessment
layer: 2
depends_on: [L1A merged]
branch: swarm/zippering/l2b-haiku
file_claims:
  - src/lib/zippering-haiku.ts
  - src/lib/zippering-haiku.test.ts
estimated_lines: 180
estimated_minutes: 45
```

**Brief:** Wrap the Anthropic SDK call that asks Haiku to decide whether an
incoming column from an integration should JOIN an existing canonical,
APPEND as new, or be flagged UNCLEAR for review. Per
[plan §4](./zippering-plan.md#4-the-haiku-assessment) and
[handoff §3.4](./zippering-phase-1-handoff.md#34-file-3--srclibzippering-haikuts--test).

**Definition of done:**
- `src/lib/zippering-haiku.ts` exports `assessColumnRouting(inputs, client?)` returning `HaikuRoutingVerdict`
- `src/lib/zippering-haiku.test.ts` covers ~5 cases with an injected fake Anthropic client (NEVER calls the real API)
- The prompt + tool schema match plan §4 exactly

**Critical implementation details:**
- Model: `claude-haiku-4-5-20251001` (confirm by matching `src/lib/email-filter.ts:513` — use the same model literal that exists there)
- `temperature: 0` (non-negotiable; this is the same lesson that produced PR #60)
- `max_tokens: 256`
- `tool_choice: { type: "tool", name: "zippering_routing_verdict" }` — forces JSON output
- Tool schema enforces required fields: `verdict`, `canonical_name`, `is_global_target`, `similarity_score`, `reason`
- AbortController timeout: 8 seconds (matches the email-filter pattern)

**Prompt template** must include all five inputs documented in plan §4
(name + data_type + source + description + samples) and BOTH candidate
tiers (global canonicals first, then per-pkey).

**Required tests** (~5):
- JOIN against a global canonical (assert `is_global_target = true`)
- APPEND when no candidates match (assert `verdict = 'append'`, new canonical_name)
- UNCLEAR returns the unclear verdict and still has a canonical_name set
- Missing `source_description` doesn't break the prompt (passes "(none provided)")
- Empty candidate lists work (forces APPEND)

**Acceptance criteria:**
- tsc + lint clean
- All vitest cases green
- Tests inject a fake `client` that returns a stubbed `tool_use` block; assert the parsed verdict shape
- ZERO real network calls in tests (no live ANTHROPIC_API_KEY required for `npx vitest run`)

**Self-check before commit:**
```bash
git diff --cached --name-only
# Must list ONLY the two files above
npx tsc --noEmit && npx vitest run src/lib/zippering-haiku.test.ts
```

**PR title:** `feat(zippering): L2B — Haiku column-routing assessor`

---

### Worker L3A — Zipperer ingest engine

```yaml
worker_id: L3A
title: Zipperer ingest engine + read helpers
layer: 3
depends_on: [L1A merged, L2A merged, L2B merged]
branch: swarm/zippering/l3a-engine
file_claims:
  - src/lib/zippering.ts
  - src/lib/zippering.test.ts
estimated_lines: 350
estimated_minutes: 90
```

**Brief:** The hot path of the zipperer. Per
[plan §5](./zippering-plan.md#5-ingest-flow) and
[handoff §3.5](./zippering-phase-1-handoff.md#35-file-4--srclibzipperingts--test).

**Definition of done:**
- `src/lib/zippering.ts` exports:
  - `zipperUpsert(row: IngestRow): Promise<{ signalId: string; decisions: ZipperingDecisionRow[] }>`
  - `getZipperedRow(workspace_key, pkey): Promise<ZipperedSignalRow | null>`
  - `getZipperedTimeline(workspace_key, pkey, sinceIso): Promise<ZipperedSignalRow[]>`
  - `getDecisionHistory(workspace_key, pkey, canonical_name): Promise<ZipperingDecisionRow[]>`
- `src/lib/zippering.test.ts` covers ~8 cases with mocked Supabase (NEVER hits live DB)
- `npx vitest run src/lib/zippering.test.ts` green

**zipperUpsert algorithm** (in this exact order):
1. Default `workspace_key` to `'dugout-default'`
2. Load `global_canonical_columns` for workspace + `zippering_schema` for `(workspace_key, pkey)` (one Supabase call each, in parallel)
3. For each column in `row.columns`:
   - SELECT latest `zippering_decisions` row for `(workspace_key, pkey, source, source_column)` ORDER BY decided_at DESC LIMIT 1
   - If no decision: call `assessColumnRouting(...)`. Insert new row into `zippering_decisions`. If verdict is `'append'` or `'unclear'`, also upsert `zippering_schema` (insert if not exists, update if exists)
4. For each column, try `normalize(value, source_data_type, decision.data_type)`:
   - On success: include in the canonical_columns map
   - On `UnsafeCoercion`: insert a new `zippering_decisions` row with `decided_by='normalizer'`, `needs_review=true`, and skip writing this column's value
5. Upsert `zippered_signals` (unique on `(source, external_id)`)
6. Return `{ signalId, decisions: <all decisions touched this call> }`

**Required tests** (~8):
- **happy path**: new column, append verdict, value written, schema row created
- **cache hit**: second ingest with same `(pkey, source, source_column)` skips Haiku
- **unsafe coercion**: `UnsafeCoercion` thrown → `needs_review=true` row inserted, value not written
- **join verdict against global**: `is_global_target=true`, schema row also created with `is_global=true`
- **unclear verdict**: treated as append on data path, schema row created, `needs_review=true`
- **idempotent re-ingest**: same `(source, external_id)` updates not duplicates
- **type-mismatch coercible**: source says `epoch_ms`, canonical says `timestamp` → coerces correctly
- **multi-column row**: 3 columns in one call → each processed independently

**Mocking guidance:**
- Mock `supabaseAdmin()` to return an object whose `.from(...)` returns chainable `.select/.insert/.upsert/.eq/.order/.limit/.maybeSingle` etc. that return canned `{ data, error }` shapes
- Mock `assessColumnRouting` (inject via a parameter or vi.mock) to return known verdicts
- Tests must NOT import from `./supabase` (the real client)

**Acceptance criteria:**
- tsc + lint clean
- All 8 vitest cases green
- File stays under 400 lines (per handoff STOP CONDITION 3)
- Read helpers return correctly-shaped data even when underlying rows are empty (don't crash on null)

**Self-check before commit:**
```bash
git diff --cached --name-only
# Must list ONLY the two files above
npx tsc --noEmit && npx vitest run src/lib/zippering.test.ts
```

**PR title:** `feat(zippering): L3A — ingest engine + read helpers`

---

### Worker L4A — Explainability surface

```yaml
worker_id: L4A
title: Explainability endpoint + page
layer: 4
depends_on: [L3A merged]
branch: swarm/zippering/l4a-explain
file_claims:
  - src/app/api/zippering/explain/route.ts
  - src/app/zippering/explain/page.tsx
estimated_lines: 200
estimated_minutes: 45
```

**Brief:** The trust mechanism. Per
[plan §6](./zippering-plan.md#6-reads) and
[handoff §3.6 + §3.7](./zippering-phase-1-handoff.md#36-file-5--srcappapizipperingexplainroutets).

**Definition of done:**
- `GET /api/zippering/explain?workspace=...&pkey=...&canonical=...` returns `{ pkey, canonical, decisions: ZipperingDecisionRow[] }`
- `/zippering/explain?pkey=...&canonical=...` renders the decision history table (server-rendered, no client JS required)
- 400 on missing pkey or canonical
- 500 on DB error (sanitized message, no internal details leaked — per existing patterns from PR #66)

**Endpoint behavior:**
- `workspace` query param defaults to `'dugout-default'`
- Calls `getDecisionHistory(workspace, pkey, canonical)` from L3A
- Returns the full decision history (latest first by `decided_at`)
- `cache-control: no-store` (this is operator tooling; freshness > caching)

**Page behavior:**
- Reads `searchParams` (Next 16 — they're a Promise)
- Empty state when no decisions found
- Table columns: `decided_at`, `decided_by`, `source.source_column`, `verdict`, `score`, `reason`, `samples`
- Verdict chip color-coded by verdict + a yellow flag for `needs_review`
- No client-side state — pure server render

**No new tests required** for this worker (route is thin; lib it calls is
already tested in L3A). Manual smoke is the verification:

```bash
npm run dev &
curl -s "http://localhost:3000/api/zippering/explain?pkey=acc_sap&canonical=company_name" | jq '.decisions | length'
# Expected: 0 (no decisions exist yet)
```

**Acceptance criteria:**
- tsc + lint clean
- `curl` smoke returns 200 with `decisions: []`
- Page renders even when decisions array is empty
- 400 returned when pkey or canonical missing
- Inline `<img>` alt text + `aria-` attributes per existing landing-page accessibility standards

**Self-check before commit:**
```bash
git diff --cached --name-only
# Must list ONLY the two files above
npx tsc --noEmit && npm run lint --silent
```

**PR title:** `feat(zippering): L4A — explainability endpoint + page`

---

## 6. Coordinator instructions

The coordinator (the `/swarm-task` orchestrator) should:

1. **Read this spec end-to-end** before spawning any worker.
2. **Confirm Phase 0 status** before Layer 3 starts. Live DB integration isn't tested in any worker, but Layer 3 + Layer 4 do call `supabaseAdmin()` at runtime. If the migration hasn't been executed in Supabase, that's a deploy-time gotcha to flag to the user — the code still ships clean from a tsc/lint/vitest perspective.
3. **Spawn workers in layer order.** Each layer's PRs must MERGE before the next layer spawns (per `/swarm-task` Phase 6).
4. **Enforce claim adherence** by intersecting each worker's diff against the `file_claims` listed above. Claim violations = halt the layer.
5. **Re-fetch origin between layers.** External PRs from parallel sessions could land that touch zippering files — better to detect collisions before spawning.
6. **Run the consolidated verification after L4A merges** (§7 below).
7. **Apply PR labels** if running through the night-loop: every PR gets `night-loop`. The coordinator runs the audit gate + Opus reviewer per `ship-while-i-sleep` Phase 4.5.

`/swarm-task`'s claim arbitration handles the within-layer conflict
detection automatically. The only cross-worker shared file is none — the
decomposition above guarantees zero overlap.

## 7. Consolidated verification after L4A merges

```bash
cd /Users/jacksonshuey/Desktop/Checkbox/checkpoint
git fetch origin && git checkout main && git pull origin main

# Static checks
npx tsc --noEmit                                  # exit 0
npm run lint --silent                             # exit 0
npx vitest run                                    # all green; ~28-32 new tests
npx tsx scripts/verify-demo-scores.ts             # exit 0

# Manual smoke (requires Phase 0 migration to be LIVE in Supabase)
npm run dev &
curl -sI http://localhost:3000/api/zippering/explain?pkey=acc_sap&canonical=company_name
# Expected: HTTP/1.1 200 OK
curl -s http://localhost:3000/api/zippering/explain?pkey=acc_sap&canonical=company_name | jq
# Expected: { "pkey": "acc_sap", "canonical": "company_name", "decisions": [] }
```

If verification passes: Phase 1 is complete. Update
[`docs/zippering-plan.md`](./zippering-plan.md) §14 to mark Phase 1 done.

## 8. Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| L1A worker imports from a file that doesn't exist | Missing `AccountId` import — `src/lib/types.ts` already has it | Re-read `src/lib/types.ts:62-77`; correct the import |
| L2B tests fail because they hit the real Anthropic API | Worker forgot to inject the fake client | Inject via the `client = new Anthropic()` parameter default; tests pass `client: fakeClient` |
| L3A worker exceeds 400 lines in `zippering.ts` | Scope creep | Halt; coordinator decides whether to split into `zippering.ts` + `zippering-reads.ts` (file claim change) or trim the implementation |
| L3A tests fail on a Supabase chained-call mock | Supabase-js chain depth > what the mock returns | Use a proxy that returns itself for every method until `.then`/`await` resolves with the canned shape |
| L4A returns 404 instead of 400 on missing params | Next router didn't match the route OR `searchParams` wasn't unwrapped (it's a Promise in Next 16) | `await params; await searchParams;` per AGENTS.md note |
| `curl /api/zippering/explain` returns 500 in smoke | Phase 0 migration isn't live in Supabase | Coordinator surfaces to user; tables must be created before this endpoint can succeed at runtime |
| Cross-worker collision detected by claim audit | Two workers somehow touched a shared file (shouldn't happen with this decomposition but) | Halt the layer; coordinator picks one PR to keep + closes the other; respawns the closed worker with the original claim |

## 9. Stop conditions

The coordinator halts the swarm and asks the user when:

1. Any pre-flight check fails (gh auth, env vars, working tree dirty)
2. Phase 0 migration is needed in Supabase to validate Layer 3 read helpers but hasn't been executed (this is a soft halt — Layer 3 code can ship, but coordinator should flag)
3. A worker exceeds its estimated time by >2x (scope drift signal)
4. Claim violation in any worker
5. The plan disagrees with itself (e.g., handoff doc says one thing, plan doc says another) — flag, don't guess

## 10. Why this decomposition

- **L1A as a single-worker layer** is deliberate — types are the contract. Locking them first prevents L2A and L2B from diverging on what they expect.
- **L2A + L2B parallelize cleanly** because neither depends on the other. They're both pure, deterministic, easy to test in isolation. The largest natural parallelism gain in Phase 1.
- **L3A is the big one** but it can't safely split — `zipperUpsert` is one cohesive function and splitting it across files creates the kind of "where does this logic live" friction that the swarm pattern is meant to AVOID.
- **L4A in its own layer** because it depends on L3A's read helpers existing on main. Adding it to L3A's claim would bloat that PR past the 400-line threshold and conflate ingest logic with read surfaces.

5 workers across 4 layers — a 2-3x speedup over inline if you can keep
the coordinator + reviewer agents healthy. Lower if you run inline; still
the right discipline either way.

## 11. References

- [docs/zippering-plan.md](./zippering-plan.md) — full design (read §1-§6 + §11 before starting)
- [docs/zippering-phase-1-handoff.md](./zippering-phase-1-handoff.md) — per-file scaffolds (Layer-N workers paste their file's scaffold from §3.X into their context)
- [supabase/migrations/20260525_zippering_tables.sql](../supabase/migrations/20260525_zippering_tables.sql) — Phase 0 schema (workers must match column shapes exactly)
- [src/lib/email-filter.ts:513](../src/lib/email-filter.ts) — reference Anthropic SDK call (L2B matches this pattern)
- [src/lib/types.ts:62-77](../src/lib/types.ts) — `AccountId` brand
- [.claude/skills/swarm-task/SKILL.md](../.claude/skills/swarm-task/SKILL.md) — swarm coordinator skill
- [.claude/skills/ship-while-i-sleep/SKILL.md](../.claude/skills/ship-while-i-sleep/SKILL.md) — night-loop integration if running overnight
