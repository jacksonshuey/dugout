# Zippering — Phase 1 handoff plan

> **You are a fresh Claude session picking up the zippering build.** Read
> this doc top to bottom. The whole thing fits in ~10 minutes. Then
> execute the steps in order. Stop and ask the user only at the explicit
> "STOP CONDITIONS" callouts.

Last updated: 2026-05-25 · Author: Claude (Opus 4.7) · Owner: Jackson Shuey

---

## 0. Context — read this first (3 min)

### What is zippering?
Zippering is Haiku-driven schema reconciliation at ingest, per primary key.
When a new column from any integration arrives for a given account, Haiku
decides whether it semantically matches an existing canonical column
(JOIN) or is a new field (APPEND). The decision is cached. Subsequent rows
from the same source for the same pkey skip the Haiku call.

The full design lives in [`docs/zippering-plan.md`](./zippering-plan.md).
Read §1-§6 of that doc once before starting. Don't skim §11 — those are
the locked architectural decisions and they change how you build.

### What's already shipped (as of 2026-05-25)

| PR | What |
|---|---|
| #95 | Original plan (`docs/zippering-plan.md`) |
| #96 | Unclear verdicts → append + flag for review |
| #97 | Briefly collapsed decisions+schema — superseded by #98 |
| #98 | Restored 4-table model + hybrid global/per-pkey schema |
| #99 | All 5 open threads locked (type-write, workspace-yes, explain-phase1) |
| **#100** | **Phase 0 — Supabase migration shipped to main as SQL only (not executed)** |

`origin/main` HEAD when this handoff was written: `1b63ee9`. If main has
moved, that's fine — none of the steps below assume specific commits past
that point. Always `git fetch origin && git log origin/main -5` before
starting any branch work (multi-session collision risk per the operator's
memory).

### What you're building (Phase 1)
Six files. End state: you can call `zipperUpsert(pkey, source, row)` on
a synthetic payload and see (1) a row in `zippered_signals`, (2) decisions
in `zippering_decisions`, (3) an explainability surface that shows exactly
what Haiku did and why.

The six files:
1. `src/lib/zippering-types.ts` — TypeScript shapes for everything
2. `src/lib/zippering-coercions.ts` — write-time type coercion registry
3. `src/lib/zippering-haiku.ts` — Haiku prompt + Anthropic SDK call
4. `src/lib/zippering.ts` — the ingest engine (calls Haiku, writes to Supabase)
5. `src/app/api/zippering/explain/route.ts` — explainability endpoint
6. `src/app/zippering/explain/page.tsx` — explainability page

Plus tests: `src/lib/zippering-coercions.test.ts`,
`src/lib/zippering-haiku.test.ts`, `src/lib/zippering.test.ts`.

---

## 1. Pre-flight (5 min)

Run these in order. Stop and ask the user if any fail.

```bash
cd /Users/jacksonshuey/Desktop/Checkbox/checkpoint

# 1.1 Git state
git fetch origin
git status --short                         # working tree should be clean OR have only untracked files
git log origin/main -5 --oneline           # confirm 1b63ee9 (or later) is on main

# 1.2 GitHub auth
gh auth status                             # must be authenticated as jacksonshuey

# 1.3 Tool versions
node --version                             # >= 20
npx tsc --version                          # 5.x
npx vitest --version                       # 4.x

# 1.4 Env vars present (only checks set/unset; values stay hidden)
[ -n "${ANTHROPIC_API_KEY:-}" ] && echo "✔ ANTHROPIC_API_KEY set" || echo "✗ unset"
[ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] && echo "✔ SUPABASE_SERVICE_ROLE_KEY set" || echo "✗ unset"
[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && echo "✔ NEXT_PUBLIC_SUPABASE_URL set" || echo "✗ unset"

# 1.5 Read the plan doc
# Open and skim, focus on §3 data model, §4 Haiku prompt, §4b coercions,
# §5 ingest flow, §6 explainability.
```

**STOP CONDITION 1:** If ANTHROPIC_API_KEY or SUPABASE_SERVICE_ROLE_KEY is
unset locally, run `npx vercel env pull /tmp/env.local --environment=production --yes`
and source the keys you need. Ask the user if any other check failed.

---

## 2. Verify Phase 0 (the Supabase migration ran) (5 min)

The migration file is on main but **may not have been executed** against
the live Supabase database. Verify before building anything else.

```bash
# Look at the migration to know what to expect
cat supabase/migrations/20260525_zippering_tables.sql | head -40
```

### Path A — Migration already ran (verify only)

```sql
-- Paste in Supabase Studio SQL editor (or via supabase db psql):
select relname, relrowsecurity
from pg_class
where relname in (
  'global_canonical_columns', 'zippering_schema',
  'zippering_decisions', 'zippered_signals', 'zippering_conflicts'
)
order by relname;
```

Expected: 5 rows, all with `relrowsecurity = true`. If yes, skip to §3.

```sql
-- Also confirm seed
select count(*) from global_canonical_columns where workspace_key = 'dugout-default';
-- Expected: 17
```

### Path B — Migration hasn't run yet (run it now)

Two options:

**Option B1: Supabase Studio (manual, safest first time)**
1. Open https://supabase.com/dashboard → your project → SQL Editor
2. Open `supabase/migrations/20260525_zippering_tables.sql` in a separate window
3. Copy the entire file contents
4. Paste into SQL editor → click Run
5. Should complete in <1 second
6. Re-run the verification queries from Path A

**Option B2: Supabase CLI**
```bash
npx supabase link   # if not linked yet, follow the prompts
npx supabase db push
```

**STOP CONDITION 2:** If the migration fails with a "table already exists"
error, that's expected if it ran before. Re-run is idempotent (every
`create table` uses `if not exists`). If it fails with anything else, halt
and surface the exact error to the user.

---

## 3. Phase 1 — Build the zipperer library (90-120 min)

### 3.1 Branch + skill assignment

```bash
git checkout -B feat/zippering-phase-1 origin/main
```

You're going to build six files. Build them in dependency order so each
file's tests can pass before you move on:

1. `zippering-types.ts` (no dependencies)
2. `zippering-coercions.ts` + `.test.ts` (depends on types)
3. `zippering-haiku.ts` + `.test.ts` (depends on types)
4. `zippering.ts` + `.test.ts` (depends on all of the above + Supabase)
5. `api/zippering/explain/route.ts` (depends on zippering.ts read helpers)
6. `zippering/explain/page.tsx` (depends on the API route)

### 3.2 File 1 — `src/lib/zippering-types.ts`

The single source of TypeScript shapes for the system. Mirror the SQL
schema exactly. Key types:

```ts
import type { AccountId } from "./types";

export type ZipperingDataType =
  | "text" | "integer" | "numeric" | "boolean"
  | "timestamp" | "jsonb" | "string[]";

export type ZipperingVerdict = "join" | "append" | "unclear";

export interface GlobalCanonicalColumn {
  id: string;
  workspace_key: string;
  name: string;
  data_type: ZipperingDataType;
  description: string | null;
  semantic_tags: string[];
  created_at: string;
}

export interface ZipperingSchemaRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  canonical_name: string;
  data_type: ZipperingDataType;
  description: string | null;
  is_global: boolean;
  source_origin: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface ZipperingDecisionRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  source: string;
  source_column: string;
  source_data_type: string | null;
  source_description: string | null;
  source_samples: unknown[] | null;
  verdict: ZipperingVerdict;
  canonical_name: string;
  is_global_target: boolean;
  similarity_score: number | null;
  reason: string | null;
  needs_review: boolean;
  decided_by: string;          // 'haiku' | 'normalizer' | rep_id
  decided_at: string;
}

export interface ZipperedSignalRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  source: string;
  external_id: string | null;
  occurred_at: string;
  columns: Record<string, unknown>;
  ingested_at: string;
}

// Input to zipperUpsert(): one incoming integration row.
export interface IngestRow {
  workspace_key?: string;       // defaults to 'dugout-default'
  pkey: AccountId;
  source: string;               // 'granola' | 'sec_edgar' | ...
  external_id?: string;
  occurred_at: string;          // every signal must have a time
  columns: Record<string, IngestValue>;
}

export interface IngestValue {
  value: unknown;
  source_data_type: ZipperingDataType;
  source_description?: string;
}

// Haiku's return shape (enforced via tool_choice + strict schema).
export interface HaikuRoutingVerdict {
  verdict: ZipperingVerdict;
  canonical_name: string;
  is_global_target: boolean;
  similarity_score: number;
  reason: string;
}
```

No tests needed — this is type-only.

### 3.3 File 2 — `src/lib/zippering-coercions.ts` + test

Per plan §4b. Small registry of safe coercers.

```ts
import type { ZipperingDataType } from "./zippering-types";

export class UnsafeCoercion extends Error {
  constructor(from: ZipperingDataType, to: ZipperingDataType, value: unknown) {
    super(`Unsafe coercion ${from}→${to} for value ${JSON.stringify(value)}`);
    this.name = "UnsafeCoercion";
  }
}

type Coercer = (v: unknown) => unknown;

const COERCERS: Partial<Record<`${ZipperingDataType}→${ZipperingDataType}`, Coercer>> = {
  // Identity coercions handled separately (see normalize()).
  "integer→text":      (v) => String(v),
  "numeric→text":      (v) => String(v),
  "text→integer":      (v) => {
    if (typeof v !== "string") throw new UnsafeCoercion("text", "integer", v);
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) throw new UnsafeCoercion("text", "integer", v);
    return n;
  },
  "integer→timestamp": (v) => new Date(v as number).toISOString(),
  "timestamp→integer": (v) => new Date(v as string).getTime(),
  "text→timestamp":    (v) => {
    const d = new Date(v as string);
    if (Number.isNaN(d.getTime())) throw new UnsafeCoercion("text", "timestamp", v);
    return d.toISOString();
  },
  "text→string[]":     (v) => [v],
  "string[]→jsonb":    (v) => v,
  "text→jsonb":        (v) => v,
};

export function normalize(
  value: unknown,
  from: ZipperingDataType,
  to: ZipperingDataType,
): unknown {
  if (from === to) return value;
  const key = `${from}→${to}` as const;
  const coercer = COERCERS[key];
  if (!coercer) throw new UnsafeCoercion(from, to, value);
  return coercer(value);
}
```

Test cases (`zippering-coercions.test.ts`): identity returns same value;
each registered coercion produces the expected output; unsafe coercions
throw `UnsafeCoercion`. Should be ~10 tests, all green.

### 3.4 File 3 — `src/lib/zippering-haiku.ts` + test

The prompt + Anthropic SDK call. Per plan §4. Temperature 0. `tool_choice`
forces JSON output via the schema.

Key shape:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type {
  GlobalCanonicalColumn,
  HaikuRoutingVerdict,
  ZipperingDataType,
  ZipperingSchemaRow,
} from "./zippering-types";

const HAIKU_MODEL = "claude-haiku-4-5-20251001"; // confirm via the project's existing usage in email-filter.ts

interface AssessInputs {
  pkey: string;
  source: string;
  source_column: string;
  source_data_type: ZipperingDataType;
  source_description?: string;
  source_samples: unknown[];
  candidates_global: GlobalCanonicalColumn[];
  candidates_pkey: ZipperingSchemaRow[];
}

export async function assessColumnRouting(
  inputs: AssessInputs,
  client = new Anthropic(),  // injectable for tests
): Promise<HaikuRoutingVerdict> {
  // Build the prompt from inputs (see plan §4 for the exact template).
  // Call client.messages.create with:
  //   model: HAIKU_MODEL,
  //   temperature: 0,
  //   max_tokens: 256,
  //   tools: [ROUTING_TOOL_SCHEMA],
  //   tool_choice: { type: "tool", name: "zippering_routing_verdict" },
  //   messages: [{ role: "user", content: prompt }],
  // Parse the tool_use block, validate the shape, return.
}
```

The Anthropic tool schema:

```ts
const ROUTING_TOOL_SCHEMA = {
  name: "zippering_routing_verdict",
  description: "Decide how an incoming column from an integration should route into the zippered schema for an account.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["join", "append", "unclear"] },
      canonical_name: { type: "string", minLength: 1 },
      is_global_target: { type: "boolean" },
      similarity_score: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["verdict", "canonical_name", "is_global_target", "similarity_score", "reason"],
  },
} as const;
```

Tests (`zippering-haiku.test.ts`): inject a fake Anthropic client that
returns a known tool_use; assert the parsed verdict shape. Don't call
the real API in tests. ~5 cases (one per verdict type + one for missing
description + one for empty candidates).

Reference: `src/lib/email-filter.ts:513` for the exact Anthropic SDK
pattern this project already uses (model, temperature, tool_choice). Match
that style — same temperature 0, same forced-tool-choice approach.

### 3.5 File 4 — `src/lib/zippering.ts` + test

The ingest engine. The hot path looks exactly like plan §5. Key public
surface:

```ts
import { supabaseAdmin } from "./supabase";
import { assessColumnRouting } from "./zippering-haiku";
import { normalize, UnsafeCoercion } from "./zippering-coercions";
import type {
  IngestRow,
  ZipperingDecisionRow,
  ZipperingSchemaRow,
  ZipperedSignalRow,
} from "./zippering-types";

export async function zipperUpsert(row: IngestRow): Promise<{
  signalId: string;
  decisions: ZipperingDecisionRow[];
}> {
  // 1. Load existing schema for this (workspace_key, pkey)
  //    + global canonicals for this workspace_key.
  // 2. For each column in row.columns:
  //    a. Find latest decision for (workspace_key, pkey, source, source_column).
  //       SELECT ... ORDER BY decided_at DESC LIMIT 1.
  //    b. If none, call assessColumnRouting(); insert new decision row.
  //    c. Try to normalize value to decision.data_type. On UnsafeCoercion,
  //       insert a new decision row with needs_review=true, decided_by='normalizer',
  //       and skip writing the value.
  //    d. Upsert into zippering_schema if this introduces a new canonical for the pkey.
  // 3. Build the canonical_columns map (canonical_name → normalized value).
  // 4. Upsert into zippered_signals (unique on (source, external_id)).
  // 5. Return { signalId, decisions: [all decisions touched this call] }.
}

export async function getZipperedRow(
  workspace_key: string,
  pkey: AccountId,
): Promise<ZipperedSignalRow | null>;

export async function getZipperedTimeline(
  workspace_key: string,
  pkey: AccountId,
  sinceIso: string,
): Promise<ZipperedSignalRow[]>;

export async function getDecisionHistory(
  workspace_key: string,
  pkey: AccountId,
  canonicalName: string,
): Promise<ZipperingDecisionRow[]>;
```

Tests (`zippering.test.ts`): use a Supabase mock OR a test-scoped
workspace_key like `test-<timestamp>` so writes are isolatable + cleanable.
Mock the Haiku call (inject the client through assessColumnRouting). ~8
cases:
- happy path (new column, append verdict, value written)
- cache hit (second ingest, no Haiku call)
- unsafe coercion (UnsafeCoercion → needs_review row + value not written)
- join verdict against existing global (is_global=true on schema)
- unclear verdict (treated like append, needs_review=true)
- idempotent re-ingest (same external_id → no new row)
- type mismatch coercible (timestamp ↔ epoch_ms case)
- multi-column row (each column processed independently)

**STOP CONDITION 3:** If any test file ends up >300 lines or the
`zippering.ts` implementation exceeds 400 lines, stop and ask the user
whether to ship a tighter Phase 1 (defer reads + explainability to a
follow-up PR).

### 3.6 File 5 — `src/app/api/zippering/explain/route.ts`

The explainability endpoint. Per plan §6.

```ts
import { NextResponse } from "next/server";
import { getDecisionHistory } from "@/lib/zippering";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace_key = url.searchParams.get("workspace") ?? "dugout-default";
  const pkey = url.searchParams.get("pkey");
  const canonical = url.searchParams.get("canonical");
  if (!pkey || !canonical) {
    return NextResponse.json(
      { error: "pkey and canonical are required query params" },
      { status: 400 },
    );
  }
  try {
    const history = await getDecisionHistory(workspace_key, pkey as AccountId, canonical);
    return NextResponse.json({
      pkey,
      canonical,
      decisions: history,  // already ordered decided_at DESC
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to load decision history" },
      { status: 500 },
    );
  }
}
```

No test required for Phase 1 (route handler is thin; the lib it calls is
already tested). Manual smoke test in §4.

### 3.7 File 6 — `src/app/zippering/explain/page.tsx`

Server-rendered page that calls the API + renders a table. Per plan §6,
explainability is core product not debug — make this readable.

```tsx
import { Card } from "@/components/ui";
import { getDecisionHistory } from "@/lib/zippering";
import type { AccountId } from "@/lib/types";

interface PageProps {
  searchParams: Promise<{
    workspace?: string;
    pkey?: string;
    canonical?: string;
  }>;
}

export default async function ZipperingExplainPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const workspace = params.workspace ?? "dugout-default";
  const pkey = params.pkey;
  const canonical = params.canonical;

  if (!pkey || !canonical) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-semibold">Zippering explain</h1>
        <p className="mt-3 text-sm text-muted">
          Pass <code>?pkey=acc_xxx&canonical=column_name</code> to see the
          full decision history.
        </p>
      </div>
    );
  }

  const decisions = await getDecisionHistory(workspace, pkey as AccountId, canonical);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        {canonical} <span className="text-muted text-sm">on {pkey}</span>
      </h1>
      <p className="mt-3 text-sm text-muted max-w-2xl">
        Full Haiku + operator decision history for this canonical column.
        Latest entry is the active routing.
      </p>
      <Card className="mt-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-[0.1em] text-muted font-mono border-b border-border">
            <tr>
              <th className="text-left p-3">Decided at</th>
              <th className="text-left p-3">By</th>
              <th className="text-left p-3">Source · column</th>
              <th className="text-left p-3">Verdict</th>
              <th className="text-left p-3">Score</th>
              <th className="text-left p-3">Reason</th>
              <th className="text-left p-3">Samples</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className="p-3 font-mono text-xs">{new Date(d.decided_at).toISOString()}</td>
                <td className="p-3 font-mono text-xs">{d.decided_by}</td>
                <td className="p-3"><code>{d.source}.{d.source_column}</code></td>
                <td className="p-3">
                  <VerdictChip verdict={d.verdict} needsReview={d.needs_review} />
                </td>
                <td className="p-3 font-mono">{d.similarity_score?.toFixed(2) ?? "—"}</td>
                <td className="p-3 max-w-md">{d.reason ?? "—"}</td>
                <td className="p-3 font-mono text-xs max-w-xs truncate">
                  {d.source_samples ? JSON.stringify(d.source_samples) : "—"}
                </td>
              </tr>
            ))}
            {decisions.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  No decisions found for this (pkey, canonical) pair.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function VerdictChip({ verdict, needsReview }: { verdict: string; needsReview: boolean }) {
  // Style by verdict; flag needs_review with a yellow chip.
  // ...
}
```

---

## 4. Verify Phase 1 (15 min)

Before shipping, run the full check matrix:

```bash
# 4.1 Type + lint + test
npx tsc --noEmit                         # must exit 0
npm run lint --silent                    # must exit 0
npx vitest run                           # all green; new tests should appear

# 4.2 verify-demo-scores (defensive — make sure nothing in seed broke)
npx tsx scripts/verify-demo-scores.ts    # exit 0

# 4.3 Manual smoke — start the dev server
npm run dev                              # listen on localhost:3000 (background)

# 4.4 Smoke the explainability endpoint
curl -s "http://localhost:3000/api/zippering/explain?pkey=acc_sap&canonical=company_name" | jq '.decisions | length'
# Expected: 0 (no decisions made yet — nothing has called zipperUpsert)

# 4.5 Smoke the explainability page
curl -s "http://localhost:3000/zippering/explain?pkey=acc_sap&canonical=company_name" | grep -c "Zippering explain\|company_name"
# Expected: >= 1 (page renders even with no decisions)

# 4.6 (Optional) Synthetic ingest smoke
# Write a one-off scripts/test-zipper.ts that calls zipperUpsert with a
# synthetic Granola row for acc_sap, then re-query the explainability
# endpoint and confirm decisions appear.
```

**STOP CONDITION 4:** If tsc/lint/vitest don't all exit 0, stop and surface
the failing output. If the explainability endpoint returns 5xx, stop —
that's the canary that the lib + Supabase wiring is correct.

---

## 5. Ship Phase 1 (10 min)

Follow the project's PR conventions (squash merge, descriptive title).
Stage ONLY the files you intended; do NOT use `git add .` (the operator
has had multiple bundling accidents this week).

```bash
git add \
  src/lib/zippering-types.ts \
  src/lib/zippering-coercions.ts \
  src/lib/zippering-coercions.test.ts \
  src/lib/zippering-haiku.ts \
  src/lib/zippering-haiku.test.ts \
  src/lib/zippering.ts \
  src/lib/zippering.test.ts \
  src/app/api/zippering/explain/route.ts \
  src/app/zippering/explain/page.tsx

git diff --cached --name-only    # SELF-CHECK: must list exactly the 9 files above
git diff --cached --stat
```

Commit message template:

```
feat(zippering): Phase 1 — zipperer lib + Haiku prompt + explainability

Lands the runtime side of zippering on top of the Phase 0 migration (PR #100):

- src/lib/zippering-types.ts: TypeScript shapes mirroring the SQL schema
- src/lib/zippering-coercions.ts: write-time type coercion registry
- src/lib/zippering-haiku.ts: assessColumnRouting() — Anthropic SDK call
  at temperature 0 with tool_choice-forced JSON output schema
- src/lib/zippering.ts: zipperUpsert() ingest engine, getZipperedRow(),
  getZipperedTimeline(), getDecisionHistory() read helpers
- src/app/api/zippering/explain/route.ts: explainability endpoint
- src/app/zippering/explain/page.tsx: explainability surface (server-
  rendered table of decision history)

Tests:
- zippering-coercions.test.ts: ~10 cases covering identity, registered
  coercions, UnsafeCoercion failure modes
- zippering-haiku.test.ts: ~5 cases with injected fake Anthropic client
- zippering.test.ts: ~8 cases — happy path, cache hit, unsafe coercion,
  global vs per-pkey join, unclear-as-append, idempotent re-ingest,
  type-mismatch coercible, multi-column

All checks green: tsc, lint, vitest (XXX passing), verify-demo-scores
exits 0. Manual smoke: /api/zippering/explain returns 200 with empty
decisions list; /zippering/explain page renders.

Per docs/zippering-plan.md §10, Phase 2 (wrap newsletter adapter for
dual-write) follows next.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

PR title: `feat(zippering): Phase 1 — zipperer lib + Haiku prompt + explainability`

After merge, verify on origin/main:

```bash
git fetch origin
git log origin/main -3 --oneline
```

---

## 6. Documentation pass (10 min)

```bash
# 6.1 Update HANDOFF.md (gitignored, edited in place)
# Add a 1a entry noting Phase 1 shipped and what's next.

# 6.2 Touch docs/zippering-plan.md §14 to mark Phase 1 as DONE.
# Single-line edit; new PR titled "docs(zippering): mark Phase 1 shipped"
```

---

## 7. What Phase 2 looks like (don't do this in the handoff — context only)

Phase 2 wraps ONE existing adapter (recommend: newsletter) in dual-write
mode behind a feature flag. The adapter writes to BOTH the legacy
`external_signals` table AND calls `zipperUpsert` on the new path.
Shadow reads validate that the zippered output is sensible before
flipping any consumer to read from `zippered_signals`.

That's a follow-up PR after Phase 1. Don't bundle.

---

## 8. Troubleshooting playbook

| Symptom | Likely cause | Fix |
|---|---|---|
| `error: relation "zippering_decisions" does not exist` at runtime | Phase 0 migration didn't actually run in Supabase | Re-run §2 Path B |
| Haiku call returns malformed JSON | `tool_choice` not enforced; check the SDK call shape | Match `email-filter.ts:513` exactly |
| `UnsafeCoercion` thrown unexpectedly | Source data type mismatch with canonical's `data_type` in `zippering_schema` | Add the coercer OR override Haiku's chosen `data_type` |
| Test fails on Supabase write | Hitting the real DB without isolation | Use a `workspace_key = test-<timestamp>` and clean up in `afterAll`, OR mock supabaseAdmin |
| Explainability page returns 500 | `getDecisionHistory` query has bad column name | Check that `zippering-types.ts` matches the SQL exactly |
| ANTHROPIC_API_KEY missing in test runs | vitest doesn't load .env.local | Inject the Anthropic client in tests; never call the real API from vitest |

---

## 9. Stop conditions — when to halt and ask the user

1. **§1 pre-flight fails** with anything other than the documented
   ANTHROPIC_API_KEY / Supabase env var fixes.
2. **§2 Phase 0 migration fails** with anything other than "already exists."
3. **§3.5 implementation grows beyond 400 lines** in `zippering.ts` —
   probably scope drift; offer the user a tighter cut.
4. **§4 verification fails** — tsc/lint/vitest not green, or smoke tests
   error. Don't ship red.
5. **You discover the plan disagrees with itself** — e.g., §3 schema says
   one thing, §5 ingest flow assumes another. Flag and ask the user
   before guessing.
6. **You hit a multi-session collision** — someone else opened a PR
   touching the same files. Run `gh pr list --state open` before every
   `git push`.

For everything else: act, don't ask. The plan is locked. The pre-flight
covers the common gotchas. Run the steps in order.

---

## 10. Time budget

| Step | Estimate |
|---|---|
| §1 pre-flight | 5 min |
| §2 verify Phase 0 | 5 min |
| §3 build Phase 1 | 90-120 min |
| §4 verify Phase 1 | 15 min |
| §5 ship | 10 min |
| §6 docs pass | 10 min |
| **Total** | **~2.5 hours** |

Realistically with debugging: 3-4 hours for a fresh session. Plan
accordingly — Phase 1 is a one-session-and-done if everything goes well,
a "stop, ask, resume" if it doesn't. Either is fine.

---

## 11. References

- [docs/zippering-plan.md](./zippering-plan.md) — the full design doc
- [supabase/migrations/20260525_zippering_tables.sql](../supabase/migrations/20260525_zippering_tables.sql) — Phase 0 migration
- [src/lib/email-filter.ts:513](../src/lib/email-filter.ts) — reference Anthropic SDK call (match this style)
- [src/lib/types.ts](../src/lib/types.ts) — `AccountId` brand type
- [src/data/seed.ts](../src/data/seed.ts) — `accountsById` Map, `createAccountSeed` helper
- [CLAUDE.md](../CLAUDE.md) → [AGENTS.md](../AGENTS.md) — read before writing Next.js code
