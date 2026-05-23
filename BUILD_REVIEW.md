# BUILD_REVIEW.md

> Pre-PR audit document for the `claude/agentmail-rotation` → `main` merge. Two new features ship in this final session — **dual-provider /ask chatbot** (OpenAI + Anthropic, user-chosen) and **Firecrawl per-account web-scrape pipeline** — on top of the larger session-5/6/7 work (signal-engine + SV Health + unify-signals + AgentMail + Granola + Console + Manager + Account) that already lives on this branch and is also unmerged. Plus the Greptile-review cleanups that landed in the same window.

**Branch:** `claude/agentmail-rotation` (HEAD: `388bd7a`)
**Target:** `main` (currently `6ce05d4`)
**Diff:** 27 commits, 100 files, +18,274 / −558 lines

---

## 1. Executive summary

Two features ship in this session-8 window and a much larger backlog of pre-session-8 work (sessions 5–7) goes with them, because `main` hasn't been updated since the early landing-page editorial pass. Dual-provider `/ask` (8c8c74e) adds OpenAI + Anthropic as a user-chosen, per-question pick — server-side tokens, in-UI dropdown persisted to localStorage, shared system prompt, per-session + global rate cap with hard-stop 429s, dual-schema tool definitions sourced from one array. Firecrawl (9c22eb6 + 388bd7a) adds a fifth ingestion source: a daily cron scrapes a fixed page set per tracked account, dumps markdown into a new `web_scrapes` queue, and the existing classify-pending sweeper extends to drain both queues into `external_signals` with the new `web_scrape` source.

Both features were built using the layered agentic pattern documented in `BUILD_ALIGNMENT.md` — workers F1/L1/L2/L3/D1 do the work, alignment agents A1/A2/A3/AD1 review against the 10 (now 11) principles before merge. AD1's review of /ask returned APPROVE WITH FIXES — six P2/P3 drift findings, all intentional deferrals documented in §7.

Test/lint/build state: `113/113` tests passing (89 baseline + 24 new), `eslint` clean, `tsc --noEmit` clean, `next build` clean — 22 routes including the new `/api/ask/providers`, `/api/cron/firecrawl`, and the extended `/api/cron/classify-pending`.

The two things a reviewer should hold in their head while reading the diff:

1. **The 11 alignment principles in `orgs/checkbox/BUILD_ALIGNMENT.md` are the design contract.** Every signal carries `source_tool` + `source_event_id`. Every UI claim cites a `signal_id`. Severity is exactly three tiers. The 12-type signal taxonomy is closed. AI provider neutrality (principle #11, new in this session) is the contract for any future agent surface.
2. **The AD1 P2/P3 findings are deferrals, not bugs.** Rate-limit fails open on a Supabase outage by design (the demo continues, the gap is logged). `cost_usd_estimate` and `tool_calls_count` columns are v2 telemetry scaffolding. The flat sliding-window retry hint is a UX nit. None of these block the merge.

---

## 2. Features shipped — by commit

Walking oldest to newest. The session-5/6/7 backlog on this branch is summarized in HANDOFF.md and is not re-litigated here; this section focuses on commits Greptile/PR review hasn't already covered.

**`0e1e6d4` Fix CI: regenerate lockfile.** Mechanical — `npm install` had drifted the lockfile relative to `package.json` (missing `@emnapi/*` resolved entries). One-line CI fix to keep `npm ci` deterministic.

**`39a8b4e` fix(granola): address Greptile P1 blockers on PR #13.** Four P1s. (a) Vault rotation now uses `vault.update_secret()` instead of a raw `UPDATE vault.secrets` so pgsodium re-encrypts on rotate (the raw UPDATE would have written plaintext into the encrypted column). (b) `meeting_signals` unique constraint widened to include `workspace_key` so two workspaces with overlapping seed account ids don't collide on upsert. (c) `granola-classifier` `anthropicClient()` call moved inside try/catch so a missing key returns `[]` per the documented contract instead of bubbling. (d) `/api/cron/granola` per-workspace `try/catch` so one workspace's Vault read failure doesn't abort `Promise.all` for the others. Files: `cron/granola/route.ts`, `granola-classifier.ts`, `meeting-signals.ts`, `migrations/20260523_granola_integration.sql`.

**`8e64e7f` Address Greptile P2s left over from 39a8b4e.** Four P2s. (a) RLS-enable (no policies, service-role only) on `workspace_integrations`, `meeting_signals`, `meeting_account_overrides` — matches the session-7 Supabase Advisor posture. (b) `/api/cron/granola` authorization compare swapped from `===` to `timingSafeEqual` (the helper in `src/lib/ui-auth.ts`). (c) Dropped dead `title_no_match` branch from `UnassignedMeeting.reason` and the corresponding `ReasonChip` branch + narrowing case. (d) Strengthened the "mirrors /api/account-context/route.ts" comment in `ask-tools.ts` with a ⚠️ DUPLICATION HAZARD marker; extraction into a shared `account-context.ts` deferred (touches ~200 lines across 3 files). Verified: 89/89 still pass, lint + tsc clean.

**`8c8c74e` feat(ask): dual-provider chatbot with rate cap, system prompt, UI picker.** The session's headline feature. Adds 9 new files and modifies 5; nets +2,129 / -470 LOC. See §3 for the file-by-file breakdown. AD1 reviewed → APPROVE WITH FIXES → all 6 findings are intentional deferrals (§7). Tests added: 24 new (`ask-agent.test.ts` 8, `ask-rate-limit.test.ts` 8, extended `ask-tools.test.ts` 8) bringing total to 113.

**`072eb90` orgs/checkbox: document the shipped dual-provider /ask architecture.** Docs-only. Updates `synthesis.md` "AI query layer" section to reflect dual-provider reality (was OpenAI-only). Adds principle #11 to `BUILD_ALIGNMENT.md` ("AI provider neutrality") with seven explicit sub-rules — tokens server-side, per-question UI choice, dual schemas, single routing wrapper, shared prompt, rate cap posture, and the explicit non-rule that digest/classifier stay model-specific by design. The quick-reference table + checklist both extend to enforce it. No code changes; alignment-doc only.

**`9c22eb6` Firecrawl adapter: per-account site scrape → web_scrapes → sweeper → signals.** The Firecrawl feature. Cherry-picked from the sibling `claude/firecrawl-account-scrape` branch. Adds 7 files and modifies 5 (including `cron/classify-pending/route.ts` which gets extended to drain both queues). Scope: 11 trackable accounts × 4 pages = ~44 calls/day at 1 Firecrawl credit each = ~1,320/month, well inside Jackson's ~11k credit budget. Architectural choice: scrape and classification split (mirrors the AgentMail webhook → sweeper pattern), so re-classifying as the prompt evolves doesn't re-burn Firecrawl credits.

**`388bd7a` Address Greptile review on Firecrawl adapter.** Three findings from the Firecrawl-cherry-pick PR. (a) **P1** `firecrawl-adapter.ts:71` — `scrapeAndStore` was wrapping `scrapeUrl` in try/catch and returning a plain error object, which swallowed the Firecrawl 429 throw that's supposed to propagate to the cron's catch + break (the whole point of the throw). Removed the wrapper. (b) **P2** `firecrawl-adapter.ts:101` — error-path insert had `.catch(() => null)` flattening every Supabase error into the same null as a legit dedup hit; removed so non-23505 errors halt loudly. (c) **P2** `firecrawl-client.ts:168` — `sizeBytes` was JS UTF-16 char count instead of byte count; replaced with `Buffer.byteLength(markdown, "utf8")`. Verified: 89/89 still pass, tsc + lint clean.

---

## 3. New files — file-by-file audit map

Scope limited to the two session-8 features (D1 + Firecrawl). The session-5/6/7 files (ask-tools, granola-*, sv-health, unify-signals, etc.) are also new vs `main` but were reviewed in PRs #13 and #14 and are covered in HANDOFF.md.

| Path | LOC | Purpose | Key exports | Principles touched | Tests |
|---|---|---|---|---|---|
| `src/lib/ask-system-prompt.ts` | 98 | Single system prompt sent to BOTH providers; enumerates 12 signal types, 3 severity tiers, 3 direction values, 8 tools, citation rule, boundaries | `getAskSystemPrompt({accountSlug?})` | #2 (12 types verbatim), #3 (3 tiers), #4 (3 directions), #6 (citation rule), #8 (voice), #9 (read-only boundary), #11 | indirect (via ask-agent) |
| `src/lib/anthropic-ask.ts` | 65 | Anthropic SDK wrapper sibling to `openai.ts` | `HAS_ANTHROPIC_KEY`, `getAnthropicClient()`, `ASK_ANTHROPIC_SONNET_MODEL`, `ASK_ANTHROPIC_HAIKU_MODEL` | #11 (sibling to openai.ts) | indirect |
| `src/lib/ask-agent.ts` | 672 | Provider-agnostic agent loop. One entry point, two provider loops + stub | `runAskAgent()`, `isValidProviderModel()`, `AskProvider`, `AskModel`, `ToolCallRecord`, `RunAskAgentResult` | #6 (citation preservation), #11 (single routing wrapper) | `ask-agent.test.ts` (12) |
| `src/lib/ask-rate-limit.ts` | 211 | Per-session + global rate cap. Checks 3 windows priority-ordered (global → daily → hourly). Fail-open on Supabase outage | `checkAndRecordAskRequest()`, `ASK_RATE_LIMITS`, `CheckAndRecordResult` | #11 (per-session cap protects shared tokens) | `ask-rate-limit.test.ts` (8) |
| `src/lib/ask-agent.test.ts` | 174 | Stub routing, env-key fallback, invalid combo, tool-cap, citation preservation, provider failure → stub with stubReason | — | — | 12 cases |
| `src/lib/ask-rate-limit.test.ts` | 270 | Allow + 3 cap reasons + priority ordering + Supabase outage + missing-client fail-open + insert-error allow-anyway | — | — | 8 cases |
| `src/app/api/ask/providers/route.ts` | 28 | `GET` returns `{openai, anthropic}` env-key booleans. Gated by `requireUiSession()`. Never returns the keys themselves | `GET` | #11 (server-side tokens, presence-not-value) | — |
| `src/components/ask-provider-picker.tsx` | 222 | `useAskChoice()` hook + `<AskProviderPicker>` dropdown with localStorage persistence (`DUGOUT_ASK_CHOICE`); greys out options whose env key is missing | `useAskChoice()`, `<AskProviderPicker>`, types | #11 (per-question UI choice) | — |
| `src/lib/firecrawl-client.ts` | 170 | Typed `POST /v2/scrape` wrapper. 30s client timeout. Throws hard on 429 so cron stops burning credits | `scrapeUrl()`, `FirecrawlScrapeResult` union | #9 (read-only — GET semantics, scrape only) | — |
| `src/lib/firecrawl-adapter.ts` | 133 | Per-account orchestrator. 4 pages in parallel, sequential across accounts. Stores both success and soft-failure rows | `scrapeAccount()`, `ACCOUNT_PAGES`, `AccountScrapeResult` | #6 (account_id + url is the evidence chain), #10 (no PII) | — |
| `src/lib/web-scrapes.ts` | 132 | Supabase CRUD for `web_scrapes` (mirrors `inbound-email.ts`) | `insertWebScrape()`, `markWebScrapeClassified()`, `getUnclassifiedWebScrapes()`, `getWebScrapeStats()`, types | #6 (every row is citable via web_scrape_id) | — |
| `src/lib/web-scrape-classifier.ts` | 232 | Haiku 4.5 extracts ≤5 material events per page; dedup by URL or summary-slug | `classifyWebScrape()`, types | #2 (`type` constrained to `ExternalSignalType` enum, defaults `other`), #6 (`meta.web_scrape_id`) | — |
| `src/app/api/cron/firecrawl/route.ts` | 121 | Daily 6am UTC cron. `CRON_SECRET`-gated. maxDuration=300. Bails on first hard 429 | `GET`, `POST` (POST aliases GET) | #9 (read-only across the source-system boundary) | — |
| `supabase/migrations/20260524_ask_request_log.sql` | 42 | Table + 2 indexes + RLS-enable | — | session-7 RLS posture | — |
| `supabase/migrations/20260524_web_scrapes.sql` | 49 | Table + 3 indexes (incl. partial index for sweeper queue) + unique on `(account_id, url, scraped_date)` | — | — | — |

### Deeper look — non-trivial new files

#### `src/lib/ask-agent.ts` (672 LOC) — provider-agnostic agent loop

Shape: one public `runAskAgent({question, accountSlug, provider, model})`. Routes to `runOpenAILoop`, `runAnthropicLoop`, or `runStub`. Both real-provider loops have identical structure (`MAX_AGENT_TURNS=4`, `MAX_TOOL_CALLS_PER_TURN=8`, dispatch via shared `dispatchTool`, accumulate `allCitations`, dedup at end) but speak each provider's native tool-use shape. Anthropic uses content-block messages (`text` + `tool_use` + `tool_result`); OpenAI uses string content + `tool_calls`.

External deps: `openai`, `@anthropic-ai/sdk` (type-only on the Anthropic side at module level), `@/lib/ask-tools` (shared dispatcher), `@/lib/ask-system-prompt` (shared prompt), `@/lib/openai`, `@/lib/anthropic-ask`, `@/data/seed`.

Side effects: none directly. Tool dispatch reads from Supabase and seed data via `ask-tools`. No writes.

Error posture: provider 5xx / network errors fall through to the `try/catch` at line 158, returning a stub with `stubReason: "${provider}_error: ${msg}"`. Citation-validation: if the model emits a `[citation:id]` for an id we never returned from a tool, it goes into `warnings` (not silenced) — see `extractCitationIds` + `dedupCitations`. Provider-model mismatch is also caught defensively (line 119) even though the route validates first.

What to look at first: the Anthropic loop's `messages.push({role: "assistant", content: response.content})` replay at line 376 — Anthropic requires the assistant's content array to be pushed back unmodified so the tool_use ids resolve on the next turn. The matching `tool_result` array goes into a single `user` message (line 464), not separate messages. This shape is correct per Anthropic's tool-use spec; reviewer should not "simplify" it.

#### `src/lib/ask-rate-limit.ts` (211 LOC) — three-window rate gate

Shape: `checkAndRecordAskRequest({sessionId, provider, model, questionChars})` returns either `{allowed: true}` or `{allowed: false, reason: "hourly"|"daily"|"global", retryAfterSeconds}`. Pre-check order is global → daily-session → hourly-session (global first so cap-breach wall-clock is consistent across sessions). On allow, inserts the log row BEFORE the agent runs — a request that crashes mid-agent still counts against the cap.

External deps: `@/lib/supabase` (singleton, lazy via `supabaseAdmin()`), type-only import of `AskProvider`/`AskModel` from `ask-agent`.

Side effects: one Supabase insert into `ask_request_log` per allowed request. Three `count: "exact", head: true` queries per check (global, daily, hourly).

Error posture: **fails open** on every failure path — Supabase env missing, Supabase query error, insert error, unexpected exception. Each failure path logs a `console.warn` so the gap is visible in Vercel logs. This is intentional (file header documents the trade-off): a Supabase outage shouldn't take `/ask` offline for the demo, the marginal cost of a few uncaptured requests is small.

Test seam: `RateLimitDeps = { supabase?: SupabaseClient, now?: () => Date }` — tests inject a fake client and a frozen `now`. See `ask-rate-limit.test.ts` for the patterns.

What to look at first: the `secondsUntilNextHourWindow` / `secondsUntilNextDayWindow` helpers (lines 201, 208) return a flat hour / flat day. AD1 finding F2 — this is a UX nit (we don't have cheap access to the oldest in-window timestamp here). Acceptable.

#### `src/lib/firecrawl-adapter.ts` (133 LOC) — per-account orchestrator

Shape: `scrapeAccount(account)` → `AccountScrapeResult`. For each account, builds 4 URLs from `ACCOUNT_PAGES` + `account.website`, fans them out with `Promise.all`, returns counts (attempted / succeeded / errored / deduped) + per-page details.

External deps: `./firecrawl-client` (typed wrapper), `./web-scrapes` (Supabase insert).

Side effects: 4 Firecrawl POST calls per account, 4 Supabase inserts per account.

Error posture: hard 429 from Firecrawl throws — that throw is what the cron handler catches to break out of the per-account loop. **Do not wrap `scrapeUrl` in try/catch** (the prior bug, fixed in `388bd7a`). Soft failures (404 / target 5xx) come back as `{ok: false}` and get stored as error rows (paper trail for which paths are wrong on which sites). Supabase errors during insert propagate via `insertWebScrape` (no longer swallowed as "dedup" — also fixed in `388bd7a`).

What to look at first: `ACCOUNT_PAGES = ["/", "/about", "/news", "/leadership"]` (line 27). Generic list. 40% of attempts 404 in initial runs (smarter URL discovery via Firecrawl `/map` is the obvious follow-up; not blocking).

#### `src/lib/web-scrape-classifier.ts` (232 LOC) — Haiku extractor

Shape: `classifyWebScrape(scrape, account)` → `{signals, classifier_used}`. Truncates markdown to 15K chars, prompts Haiku for ≤5 material events, parses fenced JSON, validates types against `VALID_TYPES` (12-enum), defaults unknown to `other`. Dedup-by-URL when the page references a per-event URL, else `${scraped_url}#${summary-slug-40}` so the next-day re-scrape doesn't insert duplicates.

External deps: `@anthropic-ai/sdk`, `node:fs` (env-vs-file fallback matches `news-adapter.ts`), `./types`, `./web-scrapes`, `./external-signals`.

Side effects: one Anthropic `messages.create` call per row. No DB writes (caller does insert via `insertSignalsDedup`).

Error posture: Haiku failure → `console.warn` + return `{signals: [], classifier_used: "none"}`. The row still gets `markWebScrapeClassified(id, 0)` by the sweeper, so a failed page doesn't loop forever.

What to look at first: prompt at line 88 — name-grounded ("about ${account.name}"), explicitly tells the model to skip stale bio copy, listicles, content about other companies. JSON-only output, `[]` for empty. Reviewer concern: prompt-injection from a malicious page is theoretically possible but bounded by the `is_demo: false` flag, the URL-validation regex (line 163), and the 12-enum constraint on `type`.

#### `src/app/api/cron/firecrawl/route.ts` (121 LOC) — daily cron

Shape: `GET` (alias `POST`). `CRON_SECRET`-gated. Iterates `accounts.filter(a => a.trackable && a.website)` sequentially. Per-account try/catch — Firecrawl 429 → log + record `hard_error` row + `break` out of the loop. Returns `CronResult` summary.

Side effects: scraping (per account) + Supabase inserts (per page).

Auth: `Authorization: Bearer ${CRON_SECRET}` — same pattern as `/api/cron/granola` and `/api/cron/classify-pending`. Vercel auto-injects this header for scheduled cron requests; works for manual triggers too (curl with the same header).

What to look at first: line 96 `break` on hard failure. This is what makes the 429 throw worthwhile — without the break, the cron would scrape all 11 accounts × 4 pages = 44 calls while every one fails. With it, the run stops at the first 429.

#### `src/components/ask-provider-picker.tsx` (222 LOC) — UI

Shape: `useAskChoice()` hook + `<AskProviderPicker>` component. The hook loads `/api/ask/providers` on mount, reads `DUGOUT_ASK_CHOICE` from localStorage, and offers 4 options (stub / OpenAI gpt-4o / Anthropic Sonnet 4.6 / Anthropic Haiku 4.5). Options whose env key is missing are greyed out.

Side effects: `fetch("/api/ask/providers")` on mount, `localStorage.setItem` on choice change.

What to look at first: the hook returns `{provider, model, setChoice, availability}` — callers pass `{provider, model}` to the POST `/api/ask` body. If localStorage has a stale value pointing at a now-missing key, the hook silently falls back to stub on mount.

---

## 4. Modified files — what changed and why

| Path | +X/-Y | What changed | Why |
|---|---|---|---|
| `src/lib/ask-tools.ts` | + few | Renamed `ASK_TOOL_SCHEMAS` → `ASK_TOOL_SCHEMAS_OPENAI`; added `ASK_TOOL_SCHEMAS_ANTHROPIC` derived from the same source array; kept `ASK_TOOL_SCHEMAS` as backwards-compat alias | Principle #11 — dual-schema tool definitions sourced from one place, no risk of drift |
| `src/app/api/ask/route.ts` | rewritten | Now reads `{question, accountSlug, provider?, model?}`. Mints/reads `dugout-ask-session` HttpOnly cookie. Checks rate cap BEFORE agent. 429 with `Retry-After` header + body on cap (no stub fallback). All loop logic moved into `ask-agent.ts` | Per directive #3 — hard stops at cap, no invisible degradation. Per directive #1 — tokens stay server-side |
| `src/app/ask/page.tsx` | new | Mounts `<AskProviderPicker>`; on 429 renders amber Rate Limit card and HIDES the answer card; shows model+provider in "How I got this answer" | Per directive #2 — provider/model choice is per-question UI |
| `src/components/ask-chat-panel.tsx` | new | Same picker + 429 handling for the drawer-scoped variant | Same as above |
| `src/lib/ask-tools.test.ts` | +43 | Anthropic-schema parity assertions — length 8, same names, find_signals enum constraint preserved | Catches schema drift between the two providers |
| `src/lib/external-signals.ts` | +7 / -7 | Added `"web_scrape"` to `ExternalSignalSource` union with comment | Firecrawl pipeline emits `source = "web_scrape"` — needed for type safety |
| `src/app/api/cron/classify-pending/route.ts` | +141 / -46 | Extended to drain TWO queues on one cron slot: `inbound_emails` AND `web_scrapes` (10 rows each, sequential per row). Both go through their own classifier and feed `insertSignalsDedup` | One cron slot, two queues — keeps Vercel hobby plan crons-per-day budget in check |
| `vercel.json` | +8 | Added `/api/cron/firecrawl` cron entry on `0 6 * * *` (daily 6am UTC) | Daily Firecrawl scrape schedule |
| `package.json` | +4 | Added deps: `openai ^6.39.0`, `@vercel/analytics ^2.0.1`, `simple-icons ^9.21.0`, `svix ^1.94.0` | `openai` for the OpenAI provider in `/ask`; the other three are from session-5/6/7 work already on the branch |
| `package-lock.json` | regen | Lockfile updated for the new deps + the `@emnapi/*` resolved entries CI was complaining about | Mechanical |

---

## 5. Data architecture — what flows where

### /ask request flow

```
User
 └─> /ask page (or drawer-mounted <AskChatPanel>)
      └─> <AskProviderPicker> (reads DUGOUT_ASK_CHOICE from localStorage)
           └─> POST /api/ask { question, accountSlug?, provider, model }
                ├─> requireUiSession()      ── UI session cookie gate
                ├─> mint/read dugout-ask-session cookie (rate-limit identity)
                ├─> checkAndRecordAskRequest(...)
                │    ├─> count(global daily)   ── 500/day cap
                │    ├─> count(session daily)  ── 100/day cap
                │    ├─> count(session hourly) ──  20/hr cap
                │    ├─> at cap → 429 + Retry-After  [HARD STOP]
                │    └─> allow → INSERT ask_request_log
                └─> runAskAgent({provider, model, question, accountSlug})
                     ├─> if provider=openai → runOpenAILoop
                     │    └─> client.chat.completions.create({tools: ASK_TOOL_SCHEMAS_OPENAI})
                     ├─> if provider=anthropic → runAnthropicLoop
                     │    └─> client.messages.create({tools: ASK_TOOL_SCHEMAS_ANTHROPIC})
                     ├─> if provider=stub → runStub (deterministic, real citations)
                     └─> dispatchTool(name, args) for every tool_use / tool_call
                          ├─> get_account_context / get_account_timeline / find_signals /
                          │   get_correlations / get_committee_engagement / get_calls /
                          │   get_emails / rollup
                          └─> reads from Supabase + seed via ask-tools
                              └─> every result includes signal id → collectCitations()
                                    └─> response.citations[] (provider-blind)
```

Failure modes:
- Provider 5xx → fall back to stub with `stubReason: "${provider}_error: ${msg}"` (demo continues, UI shows yellow "we tried X, it failed, here's a canned answer")
- Cap exceeded → 429 with `Retry-After` + body (NO stub fallback — hard stop, by directive)
- Supabase outage during rate-limit check → fail-open, log warning

### Firecrawl ingestion flow

```
Vercel cron (0 6 * * *)
 └─> GET /api/cron/firecrawl  [Authorization: Bearer ${CRON_SECRET}]
      └─> for each trackable account (sequential)
           └─> scrapeAccount(account)
                └─> Promise.all([4 page urls])
                     └─> scrapeAndStore(account, url)
                          └─> scrapeUrl(url)
                               ├─> POST api.firecrawl.dev/v2/scrape
                               ├─> 429 → throw → propagates to cron → break
                               └─> 404/5xx target → {ok: false}
                          └─> insertWebScrape({...})
                               └─> INSERT web_scrapes  (success row OR error row)
                               └─> 23505 → null (dedup, same day re-scrape)

Vercel cron (0 20 * * *)
 └─> GET /api/cron/classify-pending  [Authorization: Bearer ${CRON_SECRET}]
      ├─> getUnclassifiedInboundEmails(10)  ── newsletter queue
      ├─> getUnclassifiedWebScrapes(10)    ── web-scrape queue
      ├─> for each inbound row → classifyNewsletter → insertSignalsDedup → markInboundClassified
      └─> for each scrape row → classifyWebScrape → insertSignalsDedup → markWebScrapeClassified
           └─> external_signals row with source="web_scrape", meta.web_scrape_id={id}
                └─> the existing unify-signals pipeline picks this up unchanged
                    (any `source` value flows through the same UnifiedSignal shape)
```

### Tier separation

Data lives in **Supabase hot tier only** — there's no cold/warehouse tier yet. The rate-limit log is Supabase-backed (not in-memory), so it survives function cold starts. Both new tables (`ask_request_log` + `web_scrapes`) are single-workspace today — no `workspace_id` enforcement, no cross-tenant boundaries. When per-workspace auth lands, both columns are already in the schema (nullable on `ask_request_log`, derivable from `account_id` on `web_scrapes`).

---

## 6. Test coverage map

| File | What it tests | Cases |
|---|---|---|
| `src/lib/signal-engine.test.ts` | 12 canonical signal-type rules (champion_loss, momentum_change incl. direction, committee_gap, etc.) | 33 |
| `src/lib/sv-health.test.ts` | SV+ stage health score formula + bucketing | 13 |
| `src/lib/unify-signals.test.ts` | Engine + external + meeting → UnifiedSignal shape, correlation grouping, severity escalation, dedup | 27 |
| `src/lib/ask-tools.test.ts` | 8 tool dispatchers, citation collection, OpenAI schema, Anthropic schema parity, 12-enum constraint | 20 |
| `src/lib/ask-agent.test.ts` | Stub routing, env-key missing → stub with stubReason, invalid provider/model, tool-cap, citation preservation, provider failure → stub | 12 |
| `src/lib/ask-rate-limit.test.ts` | Allow path, 3 cap reasons, priority ordering, Supabase outage fail-open, missing-client fail-open, insert-error allow-anyway | 8 |
| **Total** | | **113** |

Pre-session-8 baseline: 89 (signal-engine 33 + sv-health 13 + unify-signals 27 + ask-tools 16).
Post-session-8: 113 (+12 ask-agent, +8 ask-rate-limit, +4 ask-tools dual-schema extensions).

Verification: `npm test` → `Test Files  6 passed (6) / Tests  113 passed (113) / Duration 343ms`.

---

## 7. AD1 alignment-review findings (P2/P3 — intentional deferrals)

AD1 reviewed the D1 dual-provider build against all 11 alignment principles. Verdict: APPROVE WITH FIXES. All 11 principles + all 4 of Jackson's directives PASS. Six drift findings, all P2/P3, all intentional deferrals:

**F1 — rate-limit fails open on Supabase outage.** `src/lib/ask-rate-limit.ts:72-78, 91-98, 112-117, 134-139, 156-161`. Every failure path (env-missing client, query error, insert error, unexpected exception) returns `{allowed: true}` and logs a `console.warn`. *Trade-off:* a Supabase outage would otherwise take `/ask` offline for the demo. The marginal token cost of a few uncaptured requests during a real outage is bounded (Supabase outages are minutes, not hours). *When to revisit:* if real customer traffic + real spend exposure makes the tail risk material. *Action now:* leave as-is, documented in file header.

**F2 — sliding-window retry hint is flat 60min / 24hr.** `src/lib/ask-rate-limit.ts:201-211`. `secondsUntilNextHourWindow()` and `secondsUntilNextDayWindow()` ignore the actual oldest-in-window timestamp and return the full window. *Why:* one extra Supabase query per check to get the oldest row is wasted cost for a UX nit. Telling the user "try again in 60min" when the true answer is "try again in 23min" over-quotes; under-quoting would be worse. *Action now:* leave as-is — UX nit, not principle violation.

**F3 — `cost_usd_estimate` + `tool_calls_count` columns exist but are never written.** `supabase/migrations/20260524_ask_request_log.sql:26-27` defines the columns. `src/lib/ask-rate-limit.ts:175-183` inserts the row without populating them. *Why:* v2 telemetry scaffolding. Computing cost requires a per-provider token-pricing table that doesn't exist yet. Populating tool_calls_count requires plumbing the result back to the rate-limit layer after the agent runs (architectural inversion — rate-limit runs BEFORE agent). *Action now:* leave the columns — they'll be populated when v2 telemetry lands, and adding them later requires a migration.

**F4 — `status='completed'` written pre-agent.** `src/lib/ask-rate-limit.ts:182`. The default is `'completed'` and the insert happens BEFORE `runAskAgent` runs. A request that crashes mid-agent will show as `'completed'` in the log. *Why:* the row exists for *rate-limit cap math* — what matters is "this session used a quota slot," not "this request succeeded." *Observability nit, not correctness:* a future telemetry layer that cares about `status` should write an UPDATE after the agent returns, not change the insert default. *Action now:* leave as-is; comment at lines 171-174 acknowledges.

**F5 — type-import directionality concern.** `src/lib/ask-rate-limit.ts:26` imports types from `ask-agent.ts`; `ask-agent.ts` does not import from `ask-rate-limit.ts`. AD1 flagged a future circular-import risk if rate-limit ever needs runtime imports from agent. *No actual cycle today* (type-only imports are erased at compile time). *Action now:* leave — pre-emptive refactor without a real cycle would be premature.

**F6 — cookie Secure flag verified correct on Vercel Preview.** `src/app/api/ask/route.ts:169`. `secure: process.env.NODE_ENV === "production"`. AD1 wanted confirmation that Vercel Preview deployments correctly receive `NODE_ENV=production` (so the cookie ships with the Secure flag). Verified: Vercel sets `NODE_ENV=production` for both Production and Preview deployments. Only Development (local `next dev`) gets `NODE_ENV=development` and skips Secure (correct — localhost is HTTP). *Action now:* none — was a verification request, not a code change.

---

## 8. Known issues — what a code reviewer might flag (and the answer)

**"Why is there a separate `dugout-ask-session` cookie instead of reusing `UI_SESSION`?"**
`UI_SESSION` is an HMAC of a constant secret shared across all visitors — it gates the UI, but every visitor has the same cookie value. For rate-limit identity we need per-visitor uniqueness, which is exactly what the new `dugout-ask-session` UUID cookie provides. `src/app/api/ask/route.ts:57-60, 103-109, 163-176`.

**"Why does the rate-limit fail open?"**
AD1 F1 above. Demo-continuity trade-off, documented in the file header. If a real customer surface needs fail-closed, flip the return in `checkAndRecordInner` after a Supabase failure — single-line change.

**"Why are `tool_calls_count` and `cost_usd_estimate` columns unused?"**
AD1 F3 above. v2 telemetry scaffolding; adding columns now is cheaper than a future migration.

**"Why does the Firecrawl adapter have a 40% 404 rate?"**
The per-account URL list (`/about`, `/news`, `/leadership`) is generic; not every site has all 4 paths. Smarter URL discovery via Firecrawl's `/v2/map` endpoint is the obvious next build — known follow-up, not in scope for the demo deadline.

**"Why does `ASK_TOOL_SCHEMAS` still exist as an alias for `ASK_TOOL_SCHEMAS_OPENAI`?"**
Backwards-compat for any external code or doc reference that uses the original name. Same source array (no risk of drift) — see `src/lib/ask-tools.ts`. Can be deleted in a future cleanup once we're sure nothing reads the old name.

**"Why is the cron protected by `CRON_SECRET` instead of `x-vercel-cron-signature`?"**
Vercel auto-injects `Authorization: Bearer ${CRON_SECRET}` for scheduled cron requests when `CRON_SECRET` is set in env. Same auth shape works for both Vercel-scheduled runs AND manual triggers (curl with the same header). Matches the existing pattern used by `/api/cron/granola` and `/api/cron/classify-pending`.

**"Why is the agent loop 672 lines? Could it be split?"**
The OpenAI and Anthropic loops are structurally similar but speak different SDK shapes — extracting a "generic loop" would require an abstraction layer that's just as long and harder to read. The current organization (one entry point, two parallel provider loops, shared helpers at the bottom) is the most readable shape. If a third provider lands, that's the moment to revisit.

**"`web_scrape_classifier` truncates markdown to 15K chars — what if a press-release page is longer?"**
After Firecrawl's `onlyMainContent: true` strip, real account pages land at 2–15K chars. Pages much longer than 15K are usually content-farm "news" indices where signal density tails off fast. If a real long page surfaces a missed signal, raise the cap — it's a single constant at line 30.

---

## 9. Build verification — exact commands and expected output

```bash
cd /Users/jacksonshuey/Desktop/Checkbox/checkpoint

npm install
# Expected: succeeds, no peer-dep warnings beyond the React 19 noise.

npm test
# Expected:
#  Test Files  6 passed (6)
#  Tests       113 passed (113)
#  Duration    ~350ms

npm run lint
# Expected: clean exit 0 (no console output beyond the eslint banner).

npx tsc --noEmit
# Expected: clean exit 0 (no output).

npm run build
# Expected: succeeds. 22 routes including:
#  - /api/ask  (ƒ Dynamic)
#  - /api/ask/providers  (ƒ Dynamic)
#  - /api/cron/firecrawl  (ƒ Dynamic)
#  - /api/cron/classify-pending  (ƒ Dynamic)
#  - /ask  (○ Static)
```

Verified locally just now — all four commands clean.

### Supabase verification — confirm both new tables exist

After applying the migrations in Supabase Studio:

```javascript
// scripts/_check.mjs pattern
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ask = await sb.from("ask_request_log").select("id", { count: "exact", head: true });
const scrapes = await sb.from("web_scrapes").select("id", { count: "exact", head: true });

console.log("ask_request_log:", ask.error ?? `${ask.count} rows`);
console.log("web_scrapes:    ", scrapes.error ?? `${scrapes.count} rows`);
```

Both should return row counts (0 or more) without errors. An error like `relation "ask_request_log" does not exist` means the migration didn't apply.

---

## 10. Pre-merge checklist

1. **Apply both new Supabase migrations** in Studio (Database → SQL Editor → New query):
   - `supabase/migrations/20260524_ask_request_log.sql`
   - `supabase/migrations/20260524_web_scrapes.sql`
   - (Plus `supabase/migrations/20260523_granola_integration.sql` from session 7 if it isn't already applied — it's also in this diff.)
2. **Confirm env vars in Vercel Production + Preview:**
   - `OPENAI_API_KEY` (new — for OpenAI provider in `/ask`)
   - `ANTHROPIC_API_KEY` (exists — also drives the digest + classifier + Granola pipeline)
   - `FIRECRAWL_API_KEY` (new — for daily web-scrape cron)
   - `CRON_SECRET` (exists — protects all 4 cron routes)
   - `DUGOUT_UI_SECRET` (exists — UI session gate)
   - `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (exist)
3. **Trigger `/api/cron/firecrawl` once** via Vercel cron dashboard "Run Now" (or `curl` with the CRON_SECRET) — wait for the 6am UTC schedule otherwise. Confirms Firecrawl key works and `web_scrapes` populates.
4. **Trigger `/api/cron/classify-pending`** to drain `web_scrapes` into `external_signals`. With ~44 rows from one Firecrawl run and a 10-row batch size, this needs 4–5 invocations to fully drain.
5. **Verify**:
   ```sql
   select count(*) from external_signals where source = 'web_scrape';
   ```
   Should be > 0 after step 4.
6. **Smoke-test `/ask`** with all three real options:
   - OpenAI gpt-4o
   - Anthropic Claude Sonnet 4.6
   - Anthropic Claude Haiku 4.5
   Each should return an answer with `[citation:...]` chips and provider+model shown in "How I got this answer."
7. **Confirm `vercel.json`** survived the cherry-pick — should have 4 cron entries: external-signals, firecrawl, classify-pending, granola.

---

## 11. Demo caveats (verbal-disclosure-worthy in the interview)

- **`/ask` runs in stub mode** if both `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are missing — yellow banner explains this; citations are still real (deterministic tool dispatch).
- **Firecrawl free tier is sized for testing.** YC student plan unlocks ~11k credits = ~250 days of daily runs at the current 44-page/day scope.
- **First Firecrawl run hit ~40% 404 rate.** Generic `/about` / `/news` / `/leadership` paths don't exist on every site. Smarter URL discovery via Firecrawl `/v2/map` is the obvious next build — known, not blocking.
- **Sweeper batches 10 at a time.** To clear a 44-row backlog, `/api/cron/classify-pending` needs ~5 runs. The daily 8pm UTC schedule will drain a full Firecrawl run in 5 days; if that matters, bump the batch size to 50 (single constant at the top of the file).
- **Rate-limit fails open on Supabase outage.** A real outage would let unbounded `/ask` requests through; tail risk on the token bill. Documented in AD1 F1, intentional for demo continuity.
- **Branch consolidation pending.** `main` is at `6ce05d4` (early landing-page editorial pass); this branch is `388bd7a`, 27 commits and ~+18k LOC ahead. Sessions 5–7 have not landed on main yet either — this PR will be the first merge of all of it.
