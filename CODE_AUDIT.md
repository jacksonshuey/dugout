# Dugout — Code Audit

**Branch:** `claude/code-audit-Jn2p2`
**Commit at audit:** `68792a2`
**Scope:** entire `src/` tree, config files, repo metadata. ~5,400 LOC TS/TSX.

---

## 1. Executive summary

Dugout is a small but well-shaped Next.js 16 / React 19 app: a "deal intelligence layer" that loads CRM-shaped seed data, evaluates a library of pure-function signal rules, surfaces signals as stateful tasks in a console, and synthesizes morning digests with Claude Sonnet 4.6. External signals (NewsAPI + SEC EDGAR) are ingested daily into Supabase. Workspace configuration (priorities, asset names, stack labels) lives in a cookie and flows into both rule output and LLM prompts.

The architecture is clean and the inline documentation is unusually thoughtful — comments justify decisions ("severity is the product", "deterministic first, LLM second") rather than restate code. The signal engine itself is the strongest module in the repo: each rule is a pure function tagged with severity + strategic priority, easy to test, easy to reason about.

The most pressing issues are **operational rather than structural**: several paid/side-effectful HTTP endpoints are publicly reachable on the deployed Vercel app, the workspace cookie is a soft prompt-injection surface, and the cookie storage strategy will hit the 4KB browser limit as the config grows. None block the demo; all matter before this hits real customer data.

| Severity | Count | Top items |
|---|---|---|
| **High** | 3 | Unauthenticated LLM/Slack routes; cookie content reaches Claude prompts; cookie size limit |
| **Medium** | 9 | Stale `useEffect` deps; signal ID collision risk; tasks not workspace-scoped; auto-resolve never re-fires; etc. |
| **Low** | 9 | Dead deps; stale `.env.example` reference; no tests; row-click a11y; etc. |

---

## 2. Project at a glance

- **Stack:** Next.js 16.2.6 (App Router, Turbopack-era), React 19.2.4, Tailwind v4, TypeScript 5 strict.
- **Backend touchpoints:** Anthropic SDK (`claude-sonnet-4-6` for digest/studio, `claude-haiku-4-5` for news classification), Supabase (service-role) for external signals, NewsAPI + SEC EDGAR, optional Slack webhook.
- **No tests, no CI workflow, no lint-on-commit.** `npm run lint` is the only quality gate.
- **Routes:** `/` (console), `/settings`, `/spec`. API: `/api/digest`, `/api/studio`, `/api/slack`, `/api/external-signals`, `/api/cron/external-signals`. Server actions in `src/app/actions/`.
- **Build artifacts in repo:** none — `.gitignore` is clean. Recent commits show active triage discipline ("Triage Batch 1", "Triage Batch 2") with security-themed fixes already landed.

### Module map

```
src/
├── app/
│   ├── page.tsx           server-rendered shell, evaluates signals once on the server
│   ├── layout.tsx         + globals.css, fonts, Nav
│   ├── settings/          workspace config UI
│   ├── spec/              architecture/rollout/companion narrative
│   ├── actions/           server actions (workspace cookie writes, signal refresh)
│   └── api/               digest, studio, slack, external-signals, cron
├── components/            console (1,064 LOC), drawer (720), settings-form (672),
│                          task-card, sidebar, ui, toast, nav, playbook-view
├── lib/
│   ├── signal-engine.ts   13 rules + evaluateAll + computeDealHealth
│   ├── tasks.ts           reconciliation engine (signals ⇌ stored tasks)
│   ├── workspace.ts       config types + Checkbox/Generic SaaS presets
│   ├── workspace-server.ts  cookie read with light validation
│   ├── types.ts           Salesforce-aligned domain types
│   ├── claude.ts          Anthropic client + chat() wrapper
│   ├── news-adapter.ts    NewsAPI fetch + Haiku classification
│   ├── sec-adapter.ts     EDGAR 8-K ingestion (hardcoded ticker→CIK map)
│   ├── ingestion.ts       fans out per-account across adapters
│   ├── external-signals.ts  Supabase read/write + dedup
│   ├── linkedin.ts        deep-link builders (no scraping)
│   ├── slack.ts           webhook poster (live + preview modes)
│   ├── supabase.ts        lazy-init service-role client
│   └── utils.ts           cn(), formatCurrency, daysBetween + fixed TODAY
└── data/
    ├── seed.ts            11 accounts, 25 contacts, 11 opps, activities/calls/deliveries
    └── playbooks.ts       Champion Departure playbook
```

---

## 3. Architectural review

### What the design gets right

1. **Severity-tier routing as a first-class concept.** Every rule declares `severity: "blocking" | "action" | "awareness"`, and routing (Slack DM vs morning digest vs weekly roundup) flows from that tier. This is the only credible answer to "how do you avoid being a notification firehose," and it's enforced at the type level, not via prose convention.
2. **Rules are pure functions over an `EvaluationContext`.** Each rule's `evaluate(ctx) => Signal[]` is trivially testable, A/B-able, and the Signal Studio (NL → rule) emits into the same shape. The rule registry pattern in `signal-engine.ts:510` is clean.
3. **Tasks vs Signals separation.** `signals` describe the world; `tasks` are the user-mutable state machine layered on top (open/done/snoozed/muted + notes + history). Reconciliation reads signals as the source of truth and updates task state. This avoids the common "alerts you can't dismiss" trap.
4. **Workspace config genuinely drives behavior.** Asset names, deal-room labels, priorities, and stack picks flow from the cookie into rule output (`assetName()` / `assetLink()` helpers in the engine) AND into the LLM system prompts (digest + studio). Most "configurable" demos are configurable in shape only; this one isn't.
5. **Server does the heavy work once.** `app/page.tsx` evaluates all signals server-side and hands the dataset to the client console. The client only does UI state + task reconciliation. Good split.
6. **Honest seam-flagging.** README is explicit about what's real vs faked, and the seed data leans on real public companies with a "Demo scenario" chip in the drawer that explains the layering. This is a model worth keeping.

### What the design papers over

- **Cookie as durable store** (`src/lib/workspace.ts:11`, `app/actions/workspace.ts:17`). Cookies cap at ~4KB after URL-encoding; an expanded priority list with descriptions will hit that ceiling. Production needs a DB row keyed by workspace_id.
- **`Stage` is a hardcoded union type** but priorities/assets are runtime configurable. This is called out in the README, but it means rules like `STAGE_AGE_EXCEEDED` can never be authored via Studio to fire on a customer-specific stage.
- **`tasks.ts` lives in `localStorage`.** Single-browser, single-workspace, no manager-cross-rep visibility. The README acknowledges this; the rest of the system assumes a real backend.
- **No multi-tenancy boundary in Supabase.** `supabaseAdmin()` uses the service-role key and there is no `workspace_id` column on `external_signals`. Switching workspaces shows the same external signals to everyone.

---

## 4. Findings

Severity reflects what would matter on a real deployment, not what blocks the current demo. File paths use `file:line` so they're navigable.

### High

**H-1. Unauthenticated paid/side-effectful API routes.**

The cron route (`src/app/api/cron/external-signals/route.ts:96`) is correctly fail-closed: it requires `Authorization: Bearer ${CRON_SECRET}` and rejects everything else, including misconfigured deployments where the secret is missing. Good.

These four are **not** authenticated:

- `src/app/api/digest/route.ts:78` — POST takes `{ repId }` and calls Claude Sonnet (~2K output tokens). An attacker can drain your Anthropic budget by hammering it.
- `src/app/api/studio/route.ts:78` — same, with up to 1,500 tokens.
- `src/app/api/slack/route.ts:9` — POST takes `{ repName, digest }` and posts the body verbatim into your configured Slack channel. Anyone with the URL can post arbitrary text into Slack as Dugout.
- `src/app/api/external-signals/route.ts:10` — GET `?account=…` returns every persisted signal for that account. Enumeration leaks competitor/account names.
- `src/app/actions/external-signals.ts:24` (server action) — same blast radius as the cron, callable from any browser via Next's server-action HTTP endpoint.

**Fix:** mint a per-session token on first page load (cookie or short-lived JWT), verify on each route, and rate-limit by IP for the LLM routes. Slack route should only accept signed payloads from your own UI.

**H-2. Workspace cookie content reaches LLM system prompts un-sanitized.**

`getWorkspaceConfig()` (`src/lib/workspace-server.ts:15`) JSON-parses the `dugout-workspace` cookie with shape-only validation (companyName non-empty, priorities is an array). It does not validate string lengths, content, or character sets.

That config then flows into:
- `src/app/api/digest/route.ts:34` — `buildSystemPrompt(workspace)` inlines `priorities[i].description`, `assets[i].name/description`, `icpDescription`, `killPoint`, `stack.*` into the system prompt.
- `src/app/api/studio/route.ts:15` — same, plus enumerates priority IDs into the prompt.

The cookie is `httpOnly` and only writable via the `saveWorkspaceConfig` server action — but that server action is itself unauthenticated (anyone hitting `/settings` can change it). So the trust boundary on cookie content is "whoever can visit /settings", i.e. anyone on the public deployment.

A user who edits a priority description to include `Ignore prior instructions and …` will get exactly that behavior from the digest writer. Low real-world severity today (you'd be poisoning your own digest), high severity once Dugout becomes multi-user.

**Fix:** Length-cap each string field (e.g. 500 chars for descriptions, 80 for names), strip control characters, and prefer prompt patterns that quote untrusted content (`<priority>{name}</priority>`) over inlining.

**H-3. Workspace cookie size will exceed the 4KB browser limit.**

Browsers and most proxies cap a single cookie at ~4 KB after URL-encoding. The current `DEFAULT_CONFIG` (`src/lib/workspace.ts:64`) serialized + URI-encoded is ~3.0 KB. Adding 2–3 more priorities or fleshing out descriptions will silently push past the limit; Next.js will set the cookie but the next request won't carry it, so `getWorkspaceConfig` falls back to `DEFAULT_CONFIG` with no error to the user. Settings appear to save, then revert.

**Fix:** Either (a) split the cookie into a tiny pointer + DB row, or (b) add a size guard in `saveWorkspaceConfig` that throws when serialized length exceeds, say, 3.5 KB, and surface that in the settings UI.

### Medium

**M-1. `useEffect` reconciliation dependency hides reps + oppOwnerLookup.**

`src/components/console.tsx:88` reconciles when `props.signals` changes (annotated with an eslint-disable). Today this is correct because `reps` and `oppOwnerLookup` are derived from `props.opportunities`, which only changes alongside signals. As soon as a future change moves rep loading to a separate fetch (or makes owner lookup async), the hook will silently use stale data. Either include the real deps or memoize them upstream so the rule actually holds.

**M-2. Signal IDs assume one signal per (rule, opportunity).**

`src/lib/signal-engine.ts:83` builds IDs as `${ruleId}:${oppId}`. Every shipped rule today emits 0 or 1 signal per opp, so this works. The shape doesn't prevent a future rule (e.g. "missing role X" emitted once per missing role) from producing collisions, at which point `reconcile()` would dedupe them silently and tasks would point at the wrong signal body. Either change the ID format to `${ruleId}:${oppId}:${discriminator}` now, or add a duplicate-ID guard in `evaluateAll`.

**M-3. Tasks aren't workspace-scoped.**

`src/lib/tasks.ts:72` keys all storage as `"dugout-tasks"`. Switching presets in `/settings` (Checkbox → Generic SaaS) changes the rule library and asset names, but tasks from the prior workspace remain in localStorage. Most will auto-resolve on next reconcile (their signal IDs no longer exist), producing a confusing wall of "N tasks auto-resolved" toasts on first load after a switch. Scope the key by workspace identifier (or by a hash of `presetName + companyName`).

**M-4. Closed tasks block re-firing signals forever.**

`src/lib/tasks.ts:135` — if a signal fires now, the user marks it done, the signal stops firing, then later the underlying condition returns (e.g. a Finance contact gets removed again), the reconciler sees the same signal ID matching a stored `done` task and keeps it as-is. No new task is created, so the AE never sees the re-fire.

This is probably not the intended behavior for "done" (vs the explicit `muted`, which should be sticky). Consider distinguishing: `done` tasks auto-clear from store after N days, while `muted` tasks stay forever. Or close the loop deterministically by creating a new task with a re-fire suffix.

**M-5. `TODAY` constant vs `new Date()` mix.**

`src/lib/utils.ts:12` pins `TODAY = "2026-05-21"` for deterministic stage-age math in the demo. But `src/lib/tasks.ts:255` and friends use `new Date()` for `markDone` / `snooze` timestamps, and the drawer's history view sorts on those timestamps. As soon as the system clock drifts from `TODAY`, drawer history shows tasks created "today" alongside the fixed-date signal `detectedAt`. Either thread `TODAY` through everything in demo mode, or accept the inconsistency and document it.

**M-6. `fs.readFileSync` env fallback runs in production.**

`src/lib/claude.ts:16` and `src/lib/news-adapter.ts:30` both have a fallback that reads `.env.local` from disk when the env var is missing. The comment claims this is "No-op in production where Vercel injects env vars directly" — but the function still runs, hits the try/catch, finds no file, returns null, and produces the "ANTHROPIC_API_KEY is not set" error. That's fine, but the comment is misleading and the dev-only hack lives in production builds where it adds zero value. Delete the fallback (or gate it behind `NODE_ENV !== "production"`) once you're not seeing the empty-env-var problem any more.

**M-7. Stage rank is duplicated.**

`src/lib/types.ts:12` exports `STAGE_ORDER`; `src/components/console.tsx:388` re-declares the same order inline as `STAGE_RANK`. Drift risk when a stage is added/renamed. Import `STAGE_ORDER` and derive the rank from `indexOf`.

**M-8. `inlineMd` is correct but brittle.**

`src/components/console.tsx:973` escapes `&<>` first, then converts `**…**` and backticks. The escape-first order makes XSS impossible from Claude output today. The next person to extend this (links, italics, etc.) needs to maintain that ordering invariant, and there's no test. Replacing this with a tiny markdown renderer (`marked` with `breaks:true`, or a 30-line React-node walker) eliminates the risk class and the `dangerouslySetInnerHTML` calls — both warnings in security review.

**M-9. Drawer hits `/api/external-signals` on every open.**

`src/components/drawer.tsx:103` re-fetches on every `oppId` change. Opening the same deal twice in one session hits Supabase twice. A trivial `useMemo` cache keyed by `accountId` (or a tiny in-module Map) cuts that. Not urgent at current volume; will matter once a manager flips through 20 deals.

### Low / cleanup

**L-1. Dead dependencies.** `lucide-react@^1.16.0` and `class-variance-authority@^0.7.1` are in `package.json` and never imported. Remove them.

**L-2. README references `.env.example` that doesn't exist** (`README.md:35`). The file isn't in the repo. The README also doesn't list the env vars actually required by the external-signals path: `NEWSAPI_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`. Add a real `.env.example` checked in, and a "Required env" subsection.

**L-3. No tests.** The signal engine is the highest-leverage thing in the repo and is trivially testable (pure functions taking a fixture context). A single Vitest file covering each rule's positive + negative case would catch most future regressions. Same for `tasks.ts:reconcile` — pure function, plug in stored + current signals, assert merged + autoResolved.

**L-4. Pipeline row click handler is mouse-only.** `src/components/console.tsx:543` puts `onClick={() => onOpen(opp.id)}` on a `<tr>` with no `role`, no `tabIndex`, no keyboard handler. Drawer is unreachable via keyboard from the table. Either move the click target onto a button cell, or add `tabIndex={0}` + `onKeyDown` handling.

**L-5. Many non-null assertions.** 11 instances of `data.accounts.find(...)!` and similar across `console.tsx`, `drawer.tsx`, `api/digest/route.ts`. All are defensible (IDs come from the same dataset), but a single typo in a join silently throws at runtime instead of failing at TS. Consider a small `lookupBy(id, list, label)` helper that throws with a useful message.

**L-6. `AGENTS.md` instructs agents to "Read the relevant guide in `node_modules/next/dist/docs/`"** but `node_modules` isn't checked in (correctly) and isn't installed in this fresh-clone container. The instruction can't be followed by an agent without first running `npm install`. Worth noting in the same doc that agents need to install first.

**L-7. Cookie `sameSite: "lax"` is fine** but `"strict"` would be marginally better for a settings-only cookie that doesn't need to survive cross-site navigation. `src/app/actions/workspace.ts:22`.

**L-8. `console.log` in adapters.** `src/lib/news-adapter.ts:270`, `:300`, `src/lib/sec-adapter.ts:198`, `:238`. Useful during the recent Anthropic-incident triage but should move behind a tiny `log()` helper that can be silenced in production (or upgraded to Vercel logs structured fields).

**L-9. `void TODAY` at `src/components/drawer.tsx:720`.** Leftover from removing a usage. Either restore the import need or delete the line and the import. Currently silences a warning for no reason.

---

## 5. Quick-win recommendations (1–2 hours each)

In order of effort-adjusted impact:

1. **Fix H-1: gate `/api/{digest,studio,slack,external-signals}`** behind a shared bearer-token check (single env var; matches the pattern already in `cron/external-signals/route.ts`). Demo-friendly: emit a per-session token from server-rendered `<head>` and read it from a `data-` attribute in the console.
2. **Fix L-1, L-2:** drop unused deps and write the missing `.env.example`. Five-minute cleanup; matters for first-time setup.
3. **Fix M-3: workspace-scope the tasks key** with a workspace fingerprint. Eliminates the "wall of auto-resolved toasts" UX bug after preset switches.
4. **Fix M-7 + L-5:** consolidate `STAGE_RANK` to derive from `STAGE_ORDER`, introduce a `lookupBy()` helper for the `.find(...)!` pattern.
5. **Write a `signal-engine.test.ts`** with one positive + one negative fixture per rule. ~60 LOC; catches future tuning regressions for free.
6. **Fix M-8: replace `inlineMd` + `dangerouslySetInnerHTML`** with a React-node walker. Same UI, no innerHTML.

---

## 6. Strategic recommendations

These are bigger lifts but high-leverage if Dugout moves from demo to product.

1. **Persist workspace config in a real store** (Supabase has it already). Cookie becomes a `workspace_id` pointer. Solves H-3 cleanly, unlocks multi-user/multi-workspace.
2. **Make `Stage` runtime-configurable** (the README flags this as a ~2-hour job, but the value compounds: Studio-authored rules can then target customer-specific stages, which is half the pitch of "configurable per workspace").
3. **Replace `localStorage` task store with a Supabase table** keyed `(workspace_id, task_id)`. Same `reconcile()` function, swap the load/save implementation. This is what unlocks the manager view actually being useful (today's manager view can't see what an AE has marked done because it's on the AE's machine).
4. **Add per-rule action-rate tracking.** Each `markDone` / `mute` / `snooze` event should land in a `task_events` table so the rollout page's "Phase 3: Compound the loop" feedback dashboard becomes implementable. The schema already exists in `tasks.ts:25` (`TaskEvent`); it just needs to leave the browser.
5. **Add a tiny CI workflow** (`.github/workflows/check.yml`): `npm ci && npm run lint && npm test`. Will catch the most common breakages before deploy.

---

## 7. What was NOT reviewed

- Runtime correctness — `npm run build` and `npm run lint` were not executed during this audit (no `node_modules` in the container).
- Visual review of the rendered UI — no browser was launched.
- Supabase schema and RLS policies — the schema is implied by `external-signals.ts` but the actual SQL isn't in the repo.
- The deployed Vercel site itself — only the source.
- Production logs / observability stack.

If you want any of those covered, ask and I'll spin up the right tooling.
