# BUILD_ALIGNMENT.md

> The single source of truth for what every build agent's work must satisfy. Alignment agents (A1, A2, A3) walk this checklist + diff the worker's output against the referenced sections.

**For build agents:** read this doc first. Read the sections of `synthesis.md` and the spec it points you at. Then do your task. If your task requires violating a principle, *stop and escalate* — don't ship the violation.

**For alignment agents:** read this doc + the worker's diff + the relevant referenced sections. Approve or flag specific drift with file:line citations. Don't rewrite the worker's code — your job is verdict + recommendation, not implementation.

---

## The 10 alignment principles

### 1. Schema fidelity
- Field names match [`orgs/checkbox/synthesis.md §4`](synthesis.md) exactly
- Table names match the same source: `signal_instances`, `signal_correlations`, `accounts`, `contacts`, `opportunities`, etc.
- If a field is missing from the schema, *propose the addition* in a comment before using it — don't silently invent fields

### 2. Canonical signal_type only
- Every emitted signal carries a `signal_type` that's one of the 12 in [`synthesis.md §1`](synthesis.md): `champion_loss`, `champion_disengagement`, `committee_gap`, `committee_expansion`, `momentum_change`, `competitive_threat`, `shadow_research`, `account_health_decline`, `lifecycle_milestone`, `account_context`, `vertical_context`, `data_hygiene_gap`
- Source-specific labels go in the `derived` JSONB column (e.g., `derived.granola_subtype = 'finance_mentioned_not_engaged'`), not in `signal_type`

### 3. Severity is exactly 3 tiers
- `blocking | action | awareness` — nothing else
- No `critical`, `urgent`, `info`, `low`, `high`, `medium`. Just three.
- Routing per tier per [`synthesis.md "The wedge, restated"`](synthesis.md): BLOCKING = Slack DM <1hr, ACTION = today's task list <24hr, AWARENESS = weekly digest <7d

### 4. Direction is required
- `direction` column on `signal_instances` and `signal_correlations`: `negative | positive | neutral`
- Default `negative` (matches existing rule assumptions for backwards compat)
- `next_step_committed` is `momentum_change` + `direction='positive'`, NOT a new signal type

### 5. No per-signal confidence
- The `confidence` column was removed from `signal_instances` and `signal_correlations` (see [`synthesis.md "Design note: why no per-signal confidence"`](synthesis.md))
- Don't re-add it. Source-count (`count(distinct source_tool)`) is the strength signal
- `confidence` IS allowed on `graph` namespace tables (entity_aliases, entity_match_candidates) and on `transcript_segments` — those are real match-scores from real sources, not made up

### 6. Evidence chain is mandatory
- Every `signal_instances` row carries `source_tool` + `source_event_id` (idempotency key from the source)
- Every `signal_correlations` row carries `signal_ids[]` array of contributing signals
- Every UI claim/alert renders a citation chip linking to a `signal_id` that drills back to `source_event_id` and the raw payload
- **No claim without a citation.** If you can't link it to a signal, don't say it.

### 7. No direct DB access from UI
- UI components (`src/components/*`, `src/app/*/page.tsx`) fetch data via `/api/*` routes only
- Server components reading server-side may use `src/lib/*` functions (e.g., `getExternalSignals(accountId)`), never raw Supabase clients
- The exception: existing `src/data/seed.ts` is allowed for static fixture data

### 8. Voice and copy
- Opinionated, plain language. No marketing fluff. No exclamation marks in alert copy.
- Match existing voice in `src/components/console.tsx`, `src/components/drawer.tsx`, `src/components/landing/`
- Alert example — yes: *"Champion went quiet 9 days ago. CFO hasn't opened pricing."* No: *"⚠️ Action Required! Take immediate steps to re-engage this critical stakeholder!"*

### 9. Read-only v1
- Adapters CONSUME from source systems (Salesforce, Outreach, Gong, etc.) — they never WRITE back
- No `POST` / `PATCH` / `DELETE` calls to source-system APIs in any adapter
- The only thing Dugout writes to is its own Supabase instance + Slack notifications (which the user opts into)
- Earn the write before taking it; trust is more valuable than convenience

### 10. Demo data only
- No real customer API keys checked in. No real PII in seed data.
- `src/data/seed.ts` is the source of truth for fixture accounts (currently 11 real public-company names but no real deals)
- Integration keys live in Supabase Vault (per the Granola pattern), never in `.env.example` or hardcoded
- Synthetic signal scenarios in `seed.ts` should be labeled with a `__demo__` flag so they're filterable in production

### 11. AI provider neutrality (ships in commit `8c8c74e`)

The `/ask` chatbot supports OpenAI AND Anthropic as user-chosen providers. Any future agent surface must follow the same pattern:

- **Tokens server-side.** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in env vars. Dugout pays the bill. Never exposed to client (only env-key presence booleans via `/api/ask/providers`).
- **Provider/model choice is per-question, user-facing.** Persisted to localStorage (`DUGOUT_ASK_CHOICE`). Options whose env key is missing are greyed out.
- **Tool definitions are dual-schema.** `src/lib/ask-tools.ts` exports `ASK_TOOL_SCHEMAS_OPENAI` and `ASK_TOOL_SCHEMAS_ANTHROPIC` derived from the same source. Implementations are provider-blind. Adding a tool means adding it once.
- **Routing through one wrapper.** `src/lib/ask-agent.ts` `runAskAgent({provider, model, ...})` picks the right client. UI/route code never imports `openai.ts` or `anthropic-ask.ts` directly — always through the wrapper.
- **System prompt is provider-agnostic.** `src/lib/ask-system-prompt.ts` exports one prompt used by both. Same instructions, same ontology vocabulary, same citation requirement — anything provider-specific belongs in the wrapper, not the prompt.
- **Per-session rate cap protects the budget.** 20/hr + 100/day per session + 500/day global. At cap = hard 429, no stub fallback. Provider 5xx errors DO fall back to stub (different failure mode); cap-breach does not.
- **The other AI surfaces stay model-specific.** Morning digest stays on Sonnet 4.6; inbound-email classifier stays on Haiku 4.5. Those are single-shot prompts with stable cost where provider choice doesn't earn its keep. Don't generalize them unless a real customer asks.

---

## Where to look — quick reference

| If your task involves... | Read first |
|---|---|
| New canonical entity / field | `synthesis.md §4` (5-namespace ontology) + spec §4 |
| New signal type or rule | `synthesis.md §1` (the 12 types) + `signal-engine.ts` existing rules |
| New correlation pattern | `synthesis.md §6` (correlation queries) + `dictionary.md` (the 6 patterns) |
| New UX surface | `discovery/information-requirements.md` (the 6 prioritized + Hero #0) + spec §2.3 (modules) |
| New integration adapter | `tools/granola.md` (the canonical template) + the target tool's existing card in `tools/*.md` |
| AI query layer changes | `synthesis.md "The AI query layer"` + `src/lib/ask-agent.ts` (provider routing) + both OpenAI function-calling + Anthropic tool-use docs. Honor principle #11. |
| Onboarding UX | HANDOFF.md §3.5 ("UX is the integration moat") + `components/connectors-section.tsx` |
| Schema metric calculation | `metrics.md` (SV Health Score formula) |

---

## Checklist for alignment agents

Walk this for every worker agent's diff:

- [ ] **Schema fields:** every new/changed field in code matches `synthesis.md §4`. List any deviations.
- [ ] **Signal types:** any new signal emission uses one of the 12. List the type emitted and the rule that emits it.
- [ ] **Severity values:** `blocking | action | awareness` only. Flag any other value.
- [ ] **Direction values:** `negative | positive | neutral` only. Flag any other value.
- [ ] **No confidence column** on `signal_instances` or `signal_correlations`. Flag if re-added.
- [ ] **Evidence chain:** every signal has source_tool + source_event_id. Every UI claim cites a signal_id.
- [ ] **Data access pattern:** UI components don't import from `src/lib/supabase.ts` directly. They call `/api/*` or use server-component `src/lib/*` helpers.
- [ ] **Voice:** alert copy is plain and opinionated. No emojis (unless explicitly asked). No marketing language.
- [ ] **Read-only:** no `POST`/`PATCH`/`DELETE` to source-system APIs in any adapter code.
- [ ] **Demo data:** no real keys or PII. Synthetic scenarios labeled.
- [ ] **Tests:** if the worker touched code with vitest cases, did they update tests appropriately? `npm test` should pass after the worker's diff.
- [ ] **Build:** `npm run lint` and `npm run build` should pass.
- [ ] **AI provider neutrality (when touching /ask or tools):** new tools added to ask-tools.ts have both OpenAI + Anthropic schemas; no UI/route code imports `openai.ts` or `anthropic-ask.ts` directly (must go through `ask-agent.ts`). Tokens stay server-side; new agent surfaces follow the dual-provider + rate-cap + shared-system-prompt pattern.

For any item that fails, return a clear flag with:
- File path + line number
- What the principle says
- What the diff does
- Suggested fix (don't implement — just suggest)

---

## What an alignment agent does NOT do

- Does NOT rewrite the worker's code. Verdict + recommendation only.
- Does NOT add new principles to this doc unilaterally. If a new principle is needed, propose it to Jackson; he edits this file.
- Does NOT block on stylistic preferences (variable naming, comment density) — only on the 10 principles above.
- Does NOT verify business logic correctness beyond schema/signal/severity alignment. If a rule's threshold is wrong, that's a separate review.

---

## When this doc itself needs to change

- Add a new principle only when a real drift incident exposes a gap
- Renumber if you must, but prefer additive (principle #11, #12) over reshuffling
- Cross-link to the section of `synthesis.md` or the spec that justifies the new principle
- Version-stamp the change with a one-line entry at the bottom

## Changelog

- **2026-05-23** — Initial 10 principles. Aligned with `synthesis.md` post-spec-integration + confidence-removal + correlation-tightening.
