# Dugout v0.1 — Build Plan

> Companion to `/Users/jacksonshuey/Desktop/Checkbox/dugout_product_spec_v_0_1.md`. Maps the spec's architectural intent against what's actually built today, calls out the gaps, sequences the work, and names open decisions.
>
> **Audience:** future Claude sessions, contractors, or a teammate picking the repo up cold.
> **Last updated:** 2026-05-23, end of session 5.
> **Spec version this targets:** v0.1.
> **Code version this targets:** post-AgentMail-rotation WIP (`claude/firecrawl-only` lineage).

---

## TL;DR

The spec is a real v0.1 product blueprint, not notes. It defines a five-namespace ontology, fourteen product modules, a seven-screen onboarding flow, a feature dependency engine, and an evidence-first signal model. The current code is at roughly v0.0: hardcoded TypeScript signal-engine rules, a workspace cookie, and a handful of single-purpose tables (`external_signals`, `meeting_signals`, `workspace_integrations`).

The architectural intent is already consistent — the orgs/checkbox/ planning documents from earlier sessions anticipated most of the spec's structure. What's missing is the database refactor, the modules system, and the configurable signal definitions that turn the current single-tenant demo into the multi-customer product the spec describes.

Three small changes before the Checkbox interview tighten the demo story. Eight phases of post-interview work bring the codebase to the spec's definition-of-done.

---

## 1. Context

### 1.1 What changed with this spec

Prior product framing: *"deal intelligence layer for sales teams."* Implementation reflected that — a signal engine over CRM-shaped seed data with a few real adapters bolted on.

New framing (from the spec): *"the relational intelligence layer that understands how all those disconnected facts map to the same accounts, opportunities, contacts, buyer committees, meetings, risks, and next actions."*

The wider product surface now explicitly includes:

- Per-customer onboarding that computes module availability from connected integrations
- A configurable signal definition system (signal_definitions × workspace_signal_configs)
- Pre-meeting briefs, manager pipeline risk digests, and account-level intelligence as first-class outputs
- An evidence-first model where every signal links back to specific raw source objects
- A canonical ontology (admin / raw / core / graph / intel) that survives across customers and integrations

This is a bigger product than what the code currently is. That's not a problem — it's a roadmap.

### 1.2 Where the spec aligns with existing thinking

The `orgs/checkbox/` directory (added in earlier sessions) already contains:

- `dictionary.md` — 49 signals across 13 internal operating systems
- `synthesis.md` — 12-type canonical signal taxonomy + unified relational model
- `discovery/` — AE and manager workflow research
- `tools/*.md` — per-tool integration profiles for Salesforce, HubSpot, Outreach, ZoomInfo, Gong, Granola, Dock, etc.
- `metrics.md` — Selected Vendor Health Score formula

The spec generalizes this Checkbox-specific work into a customer-agnostic product. Most of the architectural decisions in `orgs/checkbox/synthesis.md` map cleanly onto the spec's `intel` namespace. The 12 canonical signal types in synthesis.md fit inside the spec's `signal_definitions` table without renaming.

### 1.3 Where the code lags

| Spec construct | Code reality | Gap class |
|---|---|---|
| Five-namespace ontology (admin / raw / core / graph / intel) | Three flat tables: `external_signals`, `meeting_signals`, `workspace_integrations` | Database refactor |
| `signal_definitions` + `workspace_signal_configs` | Hardcoded in `src/lib/signal-engine.ts` | Configurability |
| `signal_evidence` rows tied to raw objects | Signals carry `body` text; no separate evidence | Provenance |
| `entity_aliases` for cross-system identity | Domain match only (Granola adapter) | Identity resolution |
| `activity_timeline` as universal temporal spine | Per-source rows in separate tables | Unified data model |
| `integration_data_capabilities` × `feature_requirements` | `account.trackable` flag + hardcoded "domain" | Feature dependency engine |
| Seven-screen onboarding | One settings page + workspace cookie | Onboarding UX |
| Per-meeting pre-meeting brief | Daily morning digest only | Brief generation |
| 14 modules with phase tagging | 13 signal-engine rules tagged with `strategicPriority` | Module system |

Total estimated work to close all gaps: six to twelve weeks of engineering, depending on scope decisions in §3 below.

---

## 2. Phase A — Demo-day changes (ship before the interview)

Three tasks, roughly two hours of work. None of them touch the database; all of them tighten the demo narrative against the spec's vocabulary.

### A.1 Update `/spec` page to the five-namespace architecture

**Source file:** `src/app/spec/page.tsx`
**Effort:** ~45 minutes
**Why this matters:** the `/spec` page is what an interviewer scrolls to when they want to judge architectural thinking. Right now it shows a four-layer model (Data → Signal engine → Orchestration → AI synthesis). The spec uses a five-namespace model that maps better to the database structure.

**Specific changes:**
1. Replace the four-layer diagram with the five namespaces: `admin`, `raw`, `core`, `graph`, `intel`. Each becomes a card with a one-line description and example object names pulled from spec §4.
2. Add a "Modules" section listing all 14 modules from spec §2.3 with phase tags (P0 / P1 / P2). Cross-reference §12.3-12.5 of the spec for Checkbox-specific module ordering.
3. Add a short "Evidence-first principle" callout (spec §9.4) under the architecture section.

**Acceptance criteria:** the page reads as a v0.1 spec implementation plan, not a generic architecture writeup. An interviewer who reads only the `/spec` page should be able to predict what the database looks like.

### A.2 Wire the headline "Budget Approval Risk" composite signal

**Source files:** `src/lib/signal-engine.ts` (new composite rule), possibly `src/lib/types.ts` (new signal type)
**Effort:** ~30 minutes
**Why this matters:** the spec calls this signal out by name in §1.4 ("First killer demo") and §8.1 ("Signal library v0"). It's the most defensible single-signal demo because it composites five inputs (stage, transcript topic, contact role, asset delivery, follow-up activity) into one alert. Current code has the inputs distributed across multiple separate rules; combining them into one composite makes the wedge story land harder.

**Specific changes:**
1. Add a `BUDGET_APPROVAL_RISK` rule to `RULES` in `signal-engine.ts`.
2. Severity logic per spec §8.1: Action if budget mentioned + no Finance contact; Blocking if (Selected Vendor or later) + budget mentioned + no Finance contact + CFO leave-behind not delivered/viewed.
3. The signal's `body` text quotes the transcript trigger and names the missing inputs explicitly ("budget mentioned in 5/19 call; no Finance contact on opportunity; CFO leave-behind not delivered to Maya Patel").
4. The signal's `suggestedAction` matches spec's recommended actions: add Finance stakeholder, send CFO leave-behind, schedule finance alignment.

**Acceptance criteria:** at least one Pipeline row in the demo fires `BUDGET_APPROVAL_RISK` with a body that names all five inputs.

### A.3 Update HANDOFF + memory to reference the new spec

**Source files:** `HANDOFF.md` (gitignored — local only), memory files in `~/.claude/projects/.../memory/`
**Effort:** ~30 minutes
**Why this matters:** future sessions will read HANDOFF first. Right now HANDOFF points at the older `orgs/checkbox/synthesis.md` as the planning source of truth. The new spec supersedes that for customer-agnostic direction (orgs/checkbox/ remains the Checkbox-specific application of the same architecture).

**Specific changes:**
1. HANDOFF §3.5 (Product vision): add a sentence pointing at `dugout_product_spec_v_0_1.md` as the canonical product direction.
2. HANDOFF §16 (Session 5 reference docs): add an entry for `docs/spec-v0.1-build-plan.md` (this file).
3. Memory file `project_checkbox_interview.md`: append a paragraph about the spec under the existing "Session 5" section. Note that `orgs/checkbox/` is the Checkbox-specific application of the spec's architecture.
4. Memory file `reference_dugout_tooling.md`: no change needed.

**Acceptance criteria:** a fresh Claude session that reads HANDOFF + memory + this build plan can answer "what is Dugout becoming?" without needing the conversation history.

---

## 3. Phase B — Post-interview build sequence

Mapped to the spec's §11 build phases. Effort estimates assume one engineer working alone. The 9-agent swarm plan (spec §10) can parallelize much of this if Jackson decides to staff it that way.

### B.1 (Spec Phase 1) — Three-layer database refactor

**Goal:** migrate from the current flat-table model to the spec's `raw` / `core` / `intel` namespaces. Adds `admin` and `graph` namespaces as new infrastructure.

**Effort:** ~1 week

**Deliverables:**
- Supabase migration: create `raw.raw_objects`, `raw.raw_events`, `raw.source_object_mappings` tables (spec §4.4)
- Supabase migration: create `core.accounts`, `core.contacts`, `core.opportunities`, `core.meetings`, `core.activities`, `core.activity_timeline` (spec §4.5; subset for now — full set is ~25 tables)
- Supabase migration: create `intel.signal_definitions`, `intel.signal_instances`, `intel.signal_evidence`, `intel.recommendations`, `intel.briefs` (spec §5.3)
- Supabase migration: create `graph.entity_aliases`, `graph.opportunity_contacts`, `graph.account_users` (spec §4.6)
- Backfill: load the current `src/data/seed.ts` data into the new `core` tables via a one-shot script
- Backfill: convert existing `external_signals` rows into `intel.signal_instances` + `intel.signal_evidence` pairs
- Update `src/lib/external-signals.ts` and `src/lib/meeting-signals.ts` to read from the new tables
- Drop the old flat tables after the read paths are green

**Acceptance criteria:**
- All current signal-engine rules continue to fire correctly against the new schema
- Every signal has at least one `signal_evidence` row pointing back to a raw or core object
- The drawer still renders external signals + meeting signals correctly

**Reference:** spec §4 (entire), §9.1 ("Storage pattern"), §9.4 ("Evidence-first principle")

### B.2 (Spec Phase 2) — First real connectors: Salesforce + Gong

**Goal:** replace the seed data with real CRM + conversation-intelligence data from one customer. Salesforce is the spine; Gong is the conversation source.

**Effort:** ~2 weeks per connector = ~4 weeks

**Deliverables (Salesforce):**
- OAuth flow with refresh token storage in Supabase Vault (extends `lib/workspace-integrations.ts`)
- Initial sync: Account, Contact, Lead, Opportunity, OpportunityContactRole, User (spec §6.1)
- Incremental sync via SOQL or Change Data Capture
- Normalizer: SF objects → `core` canonical objects with `graph.entity_aliases` rows for identity
- Settings UI: SF connector card in the System Connectors grid (paste-once shape)
- Bulk API path for backfills

**Deliverables (Gong):**
- OAuth flow + Vault storage
- Initial sync: Calls, transcripts, participants, topic mentions (spec §6.6)
- Normalizer: Gong calls → `core.meetings` + `core.transcripts` + `core.transcript_segments`
- AI extraction: topic mentions (budget, finance, IT, etc.) → `intel.topic_mentions`
- Settings UI: Gong connector card

**Acceptance criteria:**
- A Checkbox-like customer can paste SF and Gong API keys and see their real opportunities + meetings populate within 5 minutes
- The Budget Approval Risk signal (from A.2) fires on real opportunities with real transcript quotes as evidence

**Reference:** spec §6.1 (Salesforce), §6.6 (Gong), §10.1 (Integration Research Agent), §10.4 (Connector Builder Agent), `orgs/checkbox/tools/salesforce.md` and `orgs/checkbox/tools/gong.md` for the existing per-tool research

### B.3 (Spec Phase 3) — Configurable signal definitions

**Goal:** move signal rules out of hardcoded TypeScript into the `intel.signal_definitions` table so they're configurable per workspace.

**Effort:** ~1 week

**Deliverables:**
- Seed `intel.signal_definitions` with the current 13 rules (preserve IDs + names)
- Add `intel.workspace_signal_configs` for per-workspace overrides (stage scope, amount threshold, severity overrides, routing rules)
- Refactor `src/lib/signal-engine.ts` to load definitions from DB + per-workspace configs instead of hardcoding rules
- Settings UI: per-signal configuration page (replaces the current implicit "rules ship with the engine" model)

**Acceptance criteria:**
- A workspace admin can disable a signal, change its severity threshold, or override its routing without code changes
- The catalog at `/spec` reads from `signal_definitions`, not from a hardcoded TypeScript array

**Reference:** spec §3.6 (Screen 6: Signal rules), §5.3 (signal_definitions schema)

### B.4 (Spec Phase 4) — Pre-meeting brief generation

**Goal:** new product surface. For every upcoming customer meeting, generate a synthesized brief 30 minutes before the meeting starts, delivered via Slack or email.

**Effort:** ~1 week

**Deliverables:**
- Cron route `src/app/api/cron/pre-meeting-briefs/route.ts` scanning `core.meetings` for events in the next 30 minutes
- Brief generator: Sonnet 4.6 call composing `intel.briefs` rows with sections from spec §5.3 (`what_changed`, `open_risks`, `stakeholder_map`, `buyer_priorities`, `recent_activity`, `external_context`, `recommended_questions`, `recommended_actions`, `evidence`)
- Delivery: Slack DM to meeting organizer + email fallback
- Feedback capture: thumbs up/down on each brief stored in `intel.user_feedback`

**Acceptance criteria:**
- An AE receives a brief 30 minutes before every customer meeting in their calendar
- Every fact in the brief links back to a specific `signal_evidence` row visible in a drawer
- AE feedback adjusts future briefs (signal QA loop from spec §10.6)

**Reference:** spec §2.3 (Module: Meeting Readiness Brief), §5.3 (briefs table), §7.2 (feature unlock examples)

### B.5 (Spec Phase 5) — Deal room and Slack adapters

**Goal:** complete the Checkbox-shaped integration stack. Dock for deal-room engagement; Slack for internal-team escalation context.

**Effort:** ~2 weeks total

**Deliverables:**
- Dock adapter: deal rooms, members, asset deliveries, asset engagements (spec §6.13)
- Slack adapter: account-tagged channels, internal escalations, sequence-step posts (spec §6.3)
- Both normalize into `core` objects with `graph.entity_aliases`
- CFO Leave-Behind Tracking signal: ties `asset_engagements` to opportunity stage transitions (spec §12.6)

**Acceptance criteria:**
- The Budget Approval Risk signal can cite "CFO leave-behind not viewed in Dock" as evidence
- An internal Slack message in the account channel that mentions a competitor fires Competitive Risk signal

**Reference:** spec §6.3 (Slack), §6.13 (Dock), `orgs/checkbox/tools/dock.md`

### B.6 (Spec Phase 6) — External intelligence inbox

**Goal:** market-wide news + newsletter + RSS + SEC EDGAR + funding data feeds into the same `external_articles` table with account matching.

**Effort:** ~1 week

**Status:** mostly built — the newsletter adapter (SendGrid/Mailgun) is live, NewsAPI is live, SEC EDGAR is live. What's missing: putting them under the spec's `core.external_sources` + `core.external_articles` + `core.account_external_matches` schema.

**Deliverables:**
- Migration: move current newsletter/news/SEC data into the spec's schema
- Add `account_external_matches` rows for every article linked to a known account
- External Context section in pre-meeting briefs (spec §5.3 brief_sections)

**Reference:** spec §6.20 (External market intelligence), §5.3 (briefs.external_context)

### B.7 (Spec Phase 7) — Enrichment and ABM

**Goal:** add Apollo / ZoomInfo / Clay enrichment for buying-committee discovery and named-account intelligence.

**Effort:** ~3 weeks (3 adapters × 1 week each)

**Deliverables:**
- Apollo adapter (spec §6.11)
- ZoomInfo adapter (spec §6.12)
- Clay adapter (spec §6.10)
- ABM Account Intelligence module: surfaces named-account triggers, persona changes, intent signals
- Buyer-committee suggestion: when CRM has only 1 contact on a high-ACV opportunity, suggest others from Apollo/ZoomInfo

**Reference:** spec §6.10-6.12, GTM tool research at `docs/gtm-tool-expansion-research.md` (which recommends Common Room as a must-have alongside these)

### B.8 (Spec Phase 8) — Support and billing

**Goal:** expansion-stage and renewal-risk signals from Zendesk/Intercom + Stripe/Xero.

**Effort:** ~2 weeks

**Status:** lowest priority. The spec puts this last because it's renewal/expansion focused — not where the Selected Vendor wedge lives. Defer until the new-business product is solid.

**Reference:** spec §6.14-6.17

---

## 4. Module-by-module status

Status legend: **L** = live in current code, **P** = partial (some inputs exist, signal not assembled), **N** = not started.

| Module | Status | Notes |
|---|---|---|
| 1. Meeting Readiness Brief | N | Phase B.4 |
| 2. Budget Approval Risk | P → L (A.2) | Inputs distributed across rules today; A.2 composites them |
| 3. Finance/IT Engagement Sequencing | P | `signal-engine.ts` has FINANCE_MISSING + IT_MISSING; needs sequencing logic |
| 4. Trial/POC Execution SLA | P | Champion Departure playbook exists; SLA timing not wired |
| 5. Deal Execution Consistency | L | Deal Health badge is essentially this |
| 6. Stakeholder Map Gaps | L | `NO_FINANCE_CONTACT`, `NO_IT_CONTACT` rules |
| 7. Champion Risk | L | `CHAMPION_DEPARTED` rule + Champion Departure playbook |
| 8. Competitive Risk | P | News-adapter classifies competitor_mention; not surfaced as a signal |
| 9. ABM Account Intelligence | N | Phase B.7 |
| 10. External Market Context Inbox | L | `/market-intel` page + newsletter adapter |
| 11. Manager Pipeline Risk Digest | P | `/manager` view ships team aggregates; no scheduled digest |
| 12. CRM Hygiene and Auto-Capture | N | Not in current scope |
| 13. Expansion/CS Risk | N | Phase B.8 |
| 14. Billing/Payment Risk | N | Phase B.8 |

Score: 4 live, 6 partial, 4 not-started. The interview demo can credibly claim coverage of 10 modules (live + partial), with B.1-B.4 closing the remaining gaps post-interview.

---

## 5. Open decisions

### 5.1 Opportunity-centric or account-centric

**Spec status:** open question (§13).

**Recommendation:** stay opportunity-centric for the demo. The Checkbox wedge lives on opportunities (Selected Vendor stage), the current code is opportunity-centric, and the drawer surface keys on `opp_id`.

**For v1:** add account-centric views as overlay (ABM module in Phase B.7). The schema supports both — `core.accounts` is parent to `core.opportunities` — so the choice is UX, not data.

### 5.2 First user persona

**Spec status:** open question (§13: "Is the first user the AE, manager, or RevOps admin?").

**Recommendation:** AE-first, manager-second, RevOps-third. The signals and tasks are AE-facing; the manager view aggregates AE work; RevOps Studio (NL → rule) ships only after both surfaces have user feedback.

### 5.3 Read-only or read-write to CRM in v1

**Spec status:** open question (§13).

**Recommendation:** read-only. Bad CRM writes are unrecoverable trust losses. The spec's `recommendations` model is explicitly "suggested → accepted → completed," not auto-executed. Earn the write before taking it.

### 5.4 Customer-visible ontology

**Spec status:** open question (§13: "Should customers see the ontology, or only see modules and signals?").

**Recommendation:** modules and signals only. The five-namespace ontology is internal engineering; the customer-facing language is modules. The `/spec` page in our build is for interviewers, not customers — for a real customer product, replace it with a customer-facing modules catalog.

### 5.5 Smallest "wow" demo

**Spec status:** open question (§13).

**Recommendation:** the spec's own answer in §1.4 — Budget Approval Risk fires before the next meeting with five-input evidence trail. A.2 above wires this.

---

## 6. Out of scope for v0.1

Explicit non-goals so the build doesn't drift:

1. **Auto-writes to CRM.** Recommendations stay as suggestions; AEs/managers act on them.
2. **Real-time everything.** Morning digest cadence is right for ~90% of signals. Real-time exists for blocking-tier only.
3. **Black-box health scores.** Named signals; no composite 0-100 scores that get held against the system.
4. **Predictions.** "67% chance to close" gets quoted in forecasts and becomes a liability when wrong. Stick to verifiable facts.
5. **Multi-tenant auth.** Single workspace per deployment for v0.1. Google sign-in (deferred from session 5) lands in v0.2 once the database refactor (B.1) is done.
6. **LinkedIn scraping.** Sales Navigator API is partner-gated. Substitute with Apollo / Common Room / UserGems per the GTM tool research doc.
7. **Six-figure enterprise integrations.** 6sense, Demandbase, AlphaSense, Vendr, HG Insights — all flagged as dealbreakers in `docs/gtm-tool-expansion-research.md`. Skip.
8. **Three-screen onboarding compression.** The spec's seven screens are deliberately separate. Don't collapse them into a single page.

---

## 7. How to use this document

### For a future Claude session

1. Read `HANDOFF.md` first.
2. Read `dugout_product_spec_v_0_1.md` (in the parent Checkbox directory).
3. Read this build plan.
4. Read the relevant `orgs/checkbox/` document for the specific topic at hand.
5. Confirm with Jackson what to work on first.

### For a contractor or new engineer

1. This document is the bridge between the spec (architectural intent) and the codebase (current state).
2. Phase A items are demo-prep — small, scoped, ship before the interview.
3. Phase B items are the real build — each phase is a discrete deliverable with acceptance criteria.
4. The module status matrix in §4 tells you what's already wired and what isn't.
5. The open decisions in §5 are recommendations, not mandates. Jackson decides.

### For Jackson at the interview

1. The `/spec` page (after A.1 ships) is the architectural defense.
2. The Budget Approval Risk signal (after A.2 ships) is the killer-demo example.
3. This document is the post-interview roadmap — share it with technical interviewers who ask "how would you actually build this for real?"

---

## 8. References

- **Spec:** `/Users/jacksonshuey/Desktop/Checkbox/dugout_product_spec_v_0_1.md`
- **HANDOFF:** `HANDOFF.md` (gitignored, local)
- **Checkbox-specific application:** `orgs/checkbox/` (synthesis.md is the canonical local document)
- **GTM tool expansion research:** `docs/gtm-tool-expansion-research.md`
- **Future builds parked list:** `FUTURE_BUILDS.md` (gitignored, local)
- **Case PDFs:** `/Users/jacksonshuey/Desktop/Checkbox/GTM Engineer Case.pdf` and `GTM Engineer Case Context.pdf`
