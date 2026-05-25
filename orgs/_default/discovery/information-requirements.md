# Information Requirements — AE + Manager Synthesis

> What the people who'd use Dugout actually need, when, in what shape. Synthesizes [ae-workflow.md](ae-workflow.md) and [manager-workflow.md](manager-workflow.md). Becomes the spec for the UX surfaces built on top of [../synthesis.md](../synthesis.md).

> **Relationship to the product spec.** The [Dugout Product Spec v0.1](../../../dugout_product_spec_v_0_1.md) defines the platform-level **module catalog** (14 modules, each with required canonical objects, signals, and routing). This doc is the **workspace-flavored UX synthesis** that sits on top of that catalog — it answers "what does an AE or manager actually *see* when these modules fire?" Modules are product features; surfaces are UI containers. One surface can render multiple modules; some modules don't yet have a workspace-prioritized surface. The mapping below makes that explicit.

## The one-line read

**Same underlying data, two fundamentally different lenses.** AE work is *opp-centric* (one deal deep, next-action driven). Manager work is *portfolio-centric* (many deals wide, pattern-driven). Every backend signal serves both — what differs is the *view*.

This means the build order is: ship the signal model (synthesis.md) once → render two views on top.

---

## The four product surfaces (per HANDOFF §3.5)

Dugout's actual product architecture is four surfaces, one thesis ("no AE walks into a meeting cold"). The AE + Manager surfaces below are *inside* surfaces 2 and 4; surfaces 1 and 3 are independent.

| Surface | What it is | Status today |
|---|---|---|
| **1. Stack integration** | Pluggable API-key onboarding — paste once, verify-on-connect, Vault-encrypted, daily sync. The Granola Settings → Connectors flow is the template. UX is the integration moat. | **Live for Granola** (session 5). Pattern documented in [`tools/granola.md`](../tools/granola.md). Every future adapter inherits it. |
| **2. Per-account knowledge base** | Synthesized view per account: who's engaged on the buyer side, what's happened, what's next. The drawer is the surface. | Live (drawer with external signals + meetings section). Hero surfaces in this doc all live here. |
| **3. News + vertical inbox** | Newsletter ingestion + NewsAPI + SEC EDGAR keeping AEs informed about both their accounts AND the verticals they live in. | Live (`/market-intel` + drawer per-account signals). |
| **4. Rep + manager metrics** | Task completion, action latency, deal velocity. Manager view is first-class, not an afterthought. | Implied today via the task layer; explicit manager view at `/manager` (session 5 in progress). The 6 surfaces below are this surface's UX spec. |

**The wedge sits inside this.** Selected-Vendor deal-death is the demo example *within* surface 2. The architecture supports any "AE walks in cold" pain — workspace-specific framing is per-org content in `workspace.md`, not engine logic.

---

## How our surfaces map to the spec's 14 modules

The spec's [§2.3 module catalog](../../../dugout_product_spec_v_0_1.md) lists 14 modules. Our 6 surfaces + Hero #0 implement a subset, sometimes folding several modules into one render. The table below is the explicit crosswalk so the UX work and the platform module work stay in sync.

| Our surface | Spec module(s) implemented | Mapping type |
|---|---|---|
| **Hero #0: SV Health Score** | Budget Approval Risk (#2), Finance/IT Engagement Sequencing (#3), Stakeholder Map Gaps (#6), Champion Risk (#7) | Composite — score is a weighted blend of these four module outputs at SV-stage opps |
| **1. Pre-Call Brief** | Meeting Readiness Brief (#1) | Direct 1:1 |
| **2. SV Procurement Tracker** | Budget Approval Risk (#2), Finance/IT Engagement Sequencing (#3), Stakeholder Map Gaps (#6) | Drill-down view of the same modules feeding Hero #0, scoped per-opp |
| **3. Daily Deal Delta** | *Routing config across all P0 modules* | Delivery mechanism (Slack DM), not a module itself — subscribes to high-confidence signals from any module owned by the user |
| **4. Risk-Ranked Deal List** | Manager Pipeline Risk Digest (#11) | Direct 1:1 |
| **5. Per-Rep Coaching Brief** | *Not in spec* | **Proposed addition to module catalog** — see below |
| **6. Forecast Confidence Panel** | *Not in spec* | **Proposed addition to module catalog** — see below |

**Two proposed spec additions.** Surfaces 5 and 6 don't map to any current spec module. They're manager-coaching and forecast-accuracy features that the AE+Manager research surfaced strongly. Recommend adding them to the spec's §2.3 catalog as:

- **Module #15 (proposed): Rep Coaching Digest** — aggregates per-rep call themes, discovery quality, MEDDPICC hygiene, and recommended Gong moments. Required: transcripts, MEDDPICC/SFDC fields, opportunity owner. Routing: pre-1:1 email or Slack DM to manager.
- **Module #16 (proposed): Forecast Confidence Grading** — per-opp A/B/C/D grade computed from signal evidence vs. AE-committed category. Required: opportunity stage + forecast_category, signal instances, historical close-rate baseline. Routing: Thursday-AM manager view.

## Modules from the spec that don't have a workspace-prioritized surface yet

These 14-module entries either (a) the workspace's §12 ranks P0/P1 but we haven't designed UX, or (b) are covered tangentially by an existing surface and need an explicit render. Listed in roughly the order we should design for them:

| Spec module | Workspace priority (§12) | Status in this doc | What's missing |
|---|---|---|---|
| **Trial/POC Execution SLA (#4)** | P0 | No dedicated surface | The "KPI Assessment SLA Risk" signal (§12.6) is critical to the customer but has no UX home. Likely a sub-view inside the Procurement Tracker or its own SLA timer card. |
| **Deal Execution Consistency (#5)** | P0 | No dedicated surface | Cross-deal pattern view — "do all Selected-Vendor opps have the 3 enablement assets sent?" Likely a manager-facing cohort grid. |
| **Champion Risk (#7)** | Implied in Hero #0 | Partially covered | Champion-loss is a Hero #0 component, but no dedicated drill-down. Needs its own card on the account drawer. |
| **Competitive Risk (#8)** | P1 | No dedicated surface | Competitor mention timeline exists in raw data; no rolled-up view yet. |
| **ABM Account Intelligence (#9)** | P1 | No dedicated surface | Named-account intel sits in the drawer's external-signals strip; no top-level surface. |
| **External Market Context Inbox (#10)** | P1 | Partially covered | The drawer + `/market-intel` route covers part of this. Spec module includes per-persona/topic routing we haven't built. |
| **CRM Hygiene and Auto-Capture (#12)** | P1 | No dedicated surface | The Per-Rep Coaching Brief touches it (MEDDPICC completion); needs its own admin/RevOps view. |
| **Expansion/CS Risk (#13)** | P2 | No surface | Out of scope for the interview demo. Deferred. |
| **Billing/Payment Risk (#14)** | P2 | No surface | Out of scope for the interview demo. Deferred. |

**Implication for the build queue:** Trial/POC Execution SLA and Deal Execution Consistency are both P0 in the workspace configuration but unrepresented in our 6-surface plan. If interview prep extends past the current demo scope, these are the next two surfaces to design.

## Feature Dependency Engine — the platform backbone

Per [spec §7](../../../dugout_product_spec_v_0_1.md), each integration declares what canonical objects and events it emits (`integration_data_capabilities`), and each module declares what it requires (`feature_requirements`). Dugout computes the join: **"given these connected integrations, which modules unlock with what confidence?"**

This is what powers spec §3.4 — the onboarding screen that tells a new customer "you connected Salesforce + Gong + Outreach, so Meeting Readiness Brief + Budget Approval Risk + Finance/IT Sequencing are fully unlocked; Trial Execution SLA is partial until you connect a task system." It's also what lets the same module catalog serve customers with very different stacks (a Salesforce + Gong + Outreach + Dock customer vs. a HubSpot/Granola shop each get a different unlock matrix from the same module definitions).

**For the demo, the practical implication is:** every surface in this doc declares its module dependencies, and every module declares its data dependencies. When `workspace.md` says "Dock not connected yet," the SV Procurement Tracker's asset-engagement column gracefully degrades to "—" rather than crashing. The dependency engine is the contract that makes that degradation predictable.

---

## What both personas independently demanded

Both the AE and the Manager research surfaced the same root needs in different language. This convergence is the strongest signal that the synthesis.md schema is right.

| Need | AE language | Manager language | Backend signal_type |
|---|---|---|---|
| Detect dying late-stage deals | "Selected-Vendor Procurement Tracker" | "Risk-ranked deal list" | `committee_gap` + `champion_disengagement` + `momentum_change` |
| Champion change visibility | "Champion-changed alert" | "Champion silence pattern" | `champion_loss` + `champion_disengagement` |
| Competitive pressure | "Competitor mention timeline" | "Competitor mention trending" | `competitive_threat` |
| Procurement/legal engagement | "Did Finance open the order form?" | "Procurement-stage evidence" | `committee_gap` + `shadow_research` (Dock asset opens) |
| Account news/triggers | "Account news pinned to opp" | "Trigger event scan" | `lifecycle_milestone` (Xero, ZoomInfo) + news adapter |
| Multi-thread health | "Am I single-threaded?" | "Which AEs multi-thread best?" | `committee_expansion` |

**Reconciliation note:** The persona docs used some signal names that don't match the canonical 10 (`procurement_stage_change`, `dock_engagement_decay`, `legal_redline_received`, `champion_silence`). Those are *source-level* observations; they roll up into the canonical types above. Mapping table:

| Persona doc said | Canonical signal_type |
|---|---|
| `procurement_stage_change` | `committee_gap` (when role first engages = closing the gap) |
| `dock_engagement_decay` | `champion_disengagement` |
| `legal_redline_received` | `committee_engagement` (positive, sub-type of `committee_expansion`) |
| `champion_silence` | `champion_disengagement` |
| `meeting_no_show` | `momentum_change` |
| `competitor_mention` | `competitive_threat` |
| `contact_change` | `champion_loss` (when active OCR contact) |
| `web_visit`, `intent` | `shadow_research` |
| `news_event` | `lifecycle_milestone` |
| `content_view`, `document_status` | `shadow_research` or `committee_gap` (depending on viewer role) |

The 10-type taxonomy holds. No new types needed.

---

## Where AE and Manager needs SPLIT (different data, not just different view)

| AE-only need | Manager-only need |
|---|---|
| Pre-call brief 15 min before meeting | Per-rep coaching brief before 1:1 |
| Suggested next-step / next-email | Per-rep call-theme clustering (objections, discovery quality) |
| Single-deal drilldown with citations | Cohort rollups (by stage, segment, source, competitor) |
| Personal Slack DM alerts ("3 things changed on YOUR pipe") | Forecast confidence aggregates across the team |
| Account-specific timeline | Win/loss clustering across closed deals |
| Inbound triage / routing | Marketing-source attribution (which sources actually close) |
| Sequence performance for self | Pipeline-quality trend (not just $ — quality) |

This split is what determines the routes:
- `/console` (existing) → AE opp-centric view
- `/team` (new) → Manager portfolio-centric view
- `/account/[slug]` (new) → shared deep-dive (both personas use)
- `/ask` (new) → both personas, different default prompts per persona

---

## Hero Surface #0 — Selected Vendor Health Score

> Added after reading the customer case PDF. See `../metrics.md` for the full formula and rationale.

This is the surface the CEO, SVP Revenue, Director of Finance, and RevOps Lead (the interview panel) will look at first. It sits above all 6 surfaces below and is the **single number that justifies the entire system.**

**What it is:** Every open opportunity in Selected Vendor or later gets a 0–100 composite health score, refreshed daily, with the contributing components and signals exposed inline. Score thresholds: 80–100 Healthy / 60–79 Watch / 40–59 At Risk / <40 Critical.

**Why it's surface #0:** The case publishes Selected Vendor → Close = 60% and explicitly says *"deals that reach here are dying at budget approval."* A 10pp lift on that gate = ~$1.3M recovered ARR per year. Every other surface either feeds this score or drills into it.

**Audiences (one surface, three lenses):**
- **CEO / SVP Rev:** the team-average and trend ("our SV Health is 64 this week, up from 59 last week, driven by better committee coverage")
- **Manager:** the risk-ranked list (every red and orange opp by AE)
- **AE:** the per-opp drilldown with suggested play

**Components** (weighted sum, all 0–100):
- 20% time-in-stage vs historical p75
- 30% buying-committee coverage (5 required roles: Champion / EB / Finance / IT / Legal) — heaviest weight because Priority #4
- 20% enablement-asset deployment (the 3 assets from Priority #2: CFO Leave-Behind, IT one-pager, Finance Brief)
- 20% champion engagement (days since last touch)
- 10% subtracted for active risk correlations (`champion_loss`, `committee_gap`, `competitive_threat`, `momentum_change`)

**Backend:** uses every correlation pattern from `synthesis.md` + custom SFDC fields for the enablement-asset deployment check. Every component score traces to source signal_ids per the traceability principle.

**This is the demo opening shot.** Three Selected Vendor opps side-by-side, scored 87 / 52 / 10. The 10 has 4 red components and one click reveals exactly which source events drove each.

---

## The 6 prioritized UX surfaces

Three per persona, ranked by behavioral impact. **Surfaces 1 and 4 share the same backend** — Pre-Call Brief is "one opp deep"; Risk-Ranked List is "all opps wide." Ship them together.

### AE surfaces

**1. Pre-Call Brief** *(highest AE behavioral impact)*
- **Trigger:** auto-rendered 15 min before any external calendar event
- **Content:** who's attending, role classification, what each person has touched (calls, emails, doc views, last login to Dock), what changed since last contact, top 3 risks, suggested opener
- **Replaces:** 5-8 min of tab-juggling across SFDC/Gong/LinkedIn/ZoomInfo/Dock
- **Backend:** `get_account_context()` + `get_account_timeline()` + `get_committee_engagement()` tools from the AI query layer
- **First demo moment:** "Sarah opens Slack at 9:15am, sees the brief for her 9:30 call, reads it in 60 seconds, walks in armed"

**2. Selected-Vendor Procurement Tracker** *(highest wedge alignment — the workspace-specific killer feature)*
- **Trigger:** any open opp in Selected Vendor / Negotiation stage
- **Content:** per-opp dashboard showing Finance/Legal/IT/Procurement engagement: who from each role exists on the deal, what they've touched, days-since-last-touch, redline cycle time, doc view depth (opened vs. lingered vs. downloaded)
- **Replaces:** the AE's mental tracking of "where are we on legal/security/finance"
- **Backend:** `committee_gap` correlation + `get_committee_engagement()` + asset-class-aware queries on Dock + Gong + Salesforce
- **First demo moment:** "Three Selected Vendor opps shown side-by-side: one healthy (all roles engaged), one warning (Legal opened MSA once, never returned), one critical (Finance never opened pricing). All three look the same in SFDC."

**3. Daily Deal Delta** *(highest retention / habit-forming surface)*
- **Trigger:** one Slack DM at 8am, named-book scoped, high-signal only
- **Content:** "3 things changed on your pipe overnight" — never more than 5. Each item has: account, signal_type, evidence, suggested action
- **Replaces:** Gong's noisy "deals at risk" digest that everyone disables
- **Backend:** filtered subscription to new correlations where confidence ≥ 70 and account_owner = user
- **First demo moment:** "Sarah's 8am Slack: 'Helios: champion went quiet 7 days ago; Atlas: CFO just opened the order form; Pioneer: competitor mentioned on yesterday's call'"

### Manager surfaces

**4. Risk-Ranked Deal List** *(highest manager behavioral impact — kills the Sunday-night scrub)*
- **Trigger:** loads on Monday morning + refreshes hourly
- **Content:** team's pipeline sorted by deal-risk-score (computed from correlation evidence), each row showing: rep, stage, $$, last activity, top 2 risk signals with one-click drill-down
- **Replaces:** 90-min Sunday-night SFDC + Gong stitching
- **Backend:** same `get_correlations()` as Pre-Call Brief, but `scope=team`, ranked
- **Same backend as Surface 1 — different render.** Ship together.

**5. Per-Rep Coaching Brief** *(highest forecast-accuracy + retention impact)*
- **Trigger:** before each 1:1
- **Content:** auto-generated rep summary: this week's call themes (top 3 objections faced, discovery question count vs. team avg), deal hygiene gaps (MEDDPICC field completion, OCR coverage), wins/losses, ramp progress (if applicable)
- **Replaces:** manager manually skimming 2-3 Gong calls per rep
- **Backend:** `rollup()` tool aggregating signals by `opportunity.owner_user_email`
- **Honesty note:** call-theme clustering needs an additional NLP pass on Gong tracker data — modest extension, not new architecture

**6. Forecast Confidence Panel** *(the "killer manager feature" per the research)*
- **Trigger:** Thursday morning before forecast call
- **Content:** every committed/best-case opp shows a signal-driven grade (A/B/C/D), the 2-3 signals driving the grade, and a confidence delta vs. last week. Manager sees their real exposure independent of AE sandbagging.
- **Replaces:** gut + SFDC stage report
- **Backend:** weighted scoring model across signal_types per opp (no ML; rule-based with tunable weights)
- **Defense:** "Gong research shows half of forecasted deals slip or no-decide. This feature catches the leading indicators 14 days early."

---

## What's on the screen at each surface — the wireframe checklist

For each surface, what data MUST be present (deal-killers if missing):

### Pre-Call Brief
- [ ] Calendar event title + attendees with role badges
- [ ] Last touch summary (when, what, by whom)
- [ ] Top 3 changes since last touch
- [ ] Suggested opener / talking point
- [ ] Open correlations on the account (max 3)
- [ ] One-click into account timeline
- [ ] Citation links into source systems (Gong call, Dock room, SFDC opp)

### Procurement Tracker
- [ ] Per-role engagement matrix (rows: Finance / Legal / IT / Procurement; cols: doc opens / call participation / last touch)
- [ ] Cycle time on each gate (MSA redline, security questionnaire, order form)
- [ ] Days-since-last-procurement-track-touch
- [ ] Comparison to historical close-won median for same stage
- [ ] Auto-suggested next move when a gate has been silent >N days

### Daily Deal Delta
- [ ] ≤5 items, ranked by confidence × severity
- [ ] Each item: account name, signal_type, one-line evidence, one-click action
- [ ] "Dismiss" / "Snooze" / "Acted on it" feedback (feeds rule trust scoring)

### Risk-Ranked Deal List
- [ ] Filterable by rep, stage, $$, segment
- [ ] Each row: rep, account, stage, $$, days-in-stage, top-2 risks with evidence count
- [ ] Sortable; default sort by composite risk score
- [ ] Drill into Pre-Call Brief view for any deal

### Per-Rep Coaching Brief
- [ ] Rep's quarter scorecard (attainment, pipeline coverage, hygiene score)
- [ ] This week's call themes — top 3 objections, top 3 customer concerns
- [ ] Discovery quality vs. team median
- [ ] Deals where rep added MEDDPICC vs. left blank
- [ ] 1-3 Gong moments worth reviewing together

### Forecast Confidence Panel
- [ ] Per-opp grade (A/B/C/D) with color coding
- [ ] Driver signals shown inline (1-3 per opp)
- [ ] Delta vs. last week (improved / degraded / new)
- [ ] Total team commit vs. team best-case vs. signal-grade-weighted forecast
- [ ] Drill into individual deals

---

## Anti-requirements (do NOT build) — combined from both personas

| Don't build | Why |
|---|---|
| Generic intent without account match | Both personas: noise |
| Per-call full transcripts in the UI | Managers want themes, AEs already have Gong |
| Long-form weekly email digests | AEs stop reading after week 2 |
| Real-time Slack ping per signal | Alert fatigue kills adoption — batch into Daily Deal Delta |
| Marketing attribution debates surfaced to AE | Manager-only data; AEs don't care |
| Coaching metrics surfaced to AE | Manager-only data; reps resent the surveillance |
| AI-suggested next email without context grounding | Reps spot generic copy instantly |
| Activity leaderboards (dials, emails sent) | Correlate poorly with attainment per Gong research |
| Tool-by-tool dashboards | Defeats the synthesis premise |

---

## How the AI query layer fits

Per [../synthesis.md §AI query layer](../synthesis.md), the `/ask` surface is built on tool-use over the unified store. The persona research validates which questions it must answer well.

### Day-one /ask defaults (prefilled by persona)

**AE default questions:**
1. "Why is the {currentOpenAccount} deal stalling?"
2. "Which of my deals lost momentum this week and why?"
3. "Who at {currentOpenAccount} haven't we engaged that we should?"

**Manager default questions:**
1. "Which 10 deals in my team's pipeline are most likely to slip this quarter, and why?"
2. "What objection is {rep} losing on most, and which Gong moments should I review with them?"
3. "Compared to last quarter, where in the funnel are we leaking, and is it one rep or systemic?"

These prefills double as **product proof** — they show, on day one, that the AI layer can answer the questions the personas actually ask, not generic LLM filler.

---

## Build sequence — what to ship in what order

Our UX phases are sequenced for *interview demoability*; the spec's [§11 phases](../../../dugout_product_spec_v_0_1.md) are sequenced for *platform completeness*. They are complementary, not competing. The cross-reference column makes the dependency explicit — a UX phase can't ship until the platform phase(s) it depends on are at least scaffolded.

| Phase (our docs) | Ships | Why this order | Effort | Spec phase cross-ref |
|---|---|---|---|---|
| **Phase 0** (already done) | dictionary.md + synthesis.md + tools/* + metrics.md | Foundation, no UX | done | ↔ Spec Phase 0 (Specification and research) |
| **Phase 1** | Tiered storage + `/account/[slug]` route (the unified timeline view) | Single deepest-evidence view — the substrate for everything | ~3 days | ↔ Spec Phase 1 (Core database) + Phase 2 (First three connectors: SFDC + Gong + Outreach/Granola) |
| **Phase 2** | **Selected Vendor Health Score (Hero Surface #0)** + Procurement Tracker | The metric the interview panel cares about most; the wedge made visible | ~2.5 days | ↔ Spec Phase 3 (First signal engine — Budget Approval Risk, Stakeholder Map Gap, Finance/IT Missing) |
| **Phase 3** | Pre-Call Brief + Risk-Ranked Deal List | Shared backend with Hero #0; AE + Manager activation | ~2 days | ↔ Spec Phase 4 (Pre-meeting brief) — Meeting Readiness Brief module + Manager Pipeline Risk Digest module |
| **Phase 4** | `/ask` route with 6 prefilled questions | The "free-flowing hub" framing made concrete | ~3 days | *No direct spec phase — `/ask` is the AI query layer that sits on top of all modules* |
| **Phase 5** | Daily Deal Delta (Slack) + Per-Rep Coaching Brief | Habit-forming + manager-side adoption | ~2 days | ↔ Spec Phase 5 (Deal room and Slack adapter) — Slack delivery routing; Coaching Brief is a proposed spec addition |
| **Phase 6** | Forecast Confidence Panel | Stretch — the highest-ceiling feature but most accuracy risk | ~3 days | *No direct spec phase — proposed Module #16 (Forecast Confidence Grading) belongs after spec Phase 3* |

**Spec phases 6–8 (External Intelligence Inbox, Enrichment/ABM, Support/Billing) are P1/P2 for this workspace** (§12.4–12.5) and don't gate the interview demo. They become the post-demo roadmap if the engagement continues.

**Total: ~15.5 days** if every adapter were already wired. Realistically, since the *backend signals* feeding these surfaces don't all exist yet, Phase 1-4 is the demoable scope.

---

## For the interview specifically — the minimum to demo

If you have only ~1 week of build time before the interview, ship:

1. **`/account/[slug]` route** (Phase 1) — the deep timeline view. Renders fake data from `src/data/seed.ts` augmented with synthesized signals. Proves the unified-store concept.
2. **Selected Vendor Health Score (Hero Surface #0)** — the dashboard centerpiece. Three opps shown side-by-side, scored, with the contributing components and signals exposed. This is the demo opening shot.
3. **Procurement Tracker** (Phase 2) — the wedge made visible at per-opp level. Drill-down from the Hero score.
4. **`/ask` route** (Phase 4) with one working question: "Why is {seedAccount} stalling?" — OpenAI GPT-5/4o tool-use answer with citations into the timeline. (Multi-provider hedging: Anthropic Sonnet 4.6 stays as the digest model; OpenAI powers `/ask`.)

That's four surfaces, ~6 days of focused work, and a demo arc that goes:
- *"Here's the architecture and the schema."* (synthesis.md slide)
- *"Here's the dashboard. SV Health Score — the one number that justifies the system. 10pp improvement is ~$1.3M ARR."* (Hero #0)
- *"Click any score → contributing components → contributing signals → source webhooks."* (account timeline + traceability)
- *"Here's the procurement-track view per opp — the wedge made visible."* (Procurement Tracker)
- *"And here's the AI layer that lets anyone ask anything across the stack."* (`/ask`)
- *"For Part 2: Trial Intake Orchestrator — automates Priority #1, the case's highest-leverage change."*

That's the interview win.

---

## Open product questions for Jackson

These need decisions before Phase 1 starts:

1. **Single-rep view or team view by default?** The handoff says Dugout is currently single-user. The persona research strongly suggests *two views from day one*. Do we add a workspace `viewerRole` setting (rep vs manager) in Phase 1, or defer multi-user until later?

2. **How aggressively to interpret "free-flowing hub"?** Maximum interpretation: every signal is visible to everyone on the team (high transparency, real-time activity feed Twitter-style). Minimum interpretation: each persona sees their slice, with manager getting aggregations. Most B2B sales orgs prefer the minimum — full transparency creates "why didn't you act on this signal?" awkwardness in 1:1s. **My recommendation: start minimum, add activity-feed later if requested.**

3. **Slack integration as Phase 5 or Phase 0?** Daily Deal Delta lives in Slack, not the app. That's the most habit-forming surface per the research. Argument for moving it earlier: it's how AEs actually get pulled in. Argument for later: requires Slack OAuth + per-customer setup which adds onboarding friction.

4. **What does the `/account/[slug]` timeline look like for an account with no signals yet?** Empty state matters. Probably: "Here's what we know from SFDC + ZoomInfo enrichment + news. Once you wire {Dock, Gong, etc.} more signals will appear." The empty state IS the onboarding pitch.

---

## See also

- [Dugout Product Spec v0.1](../../../dugout_product_spec_v_0_1.md) — the platform-level module catalog (§2.3), feature dependency engine (§7), build sequence (§11), and workspace-specific configuration (§12)
- [ae-workflow.md](ae-workflow.md) — full AE day-in-the-life research
- [manager-workflow.md](manager-workflow.md) — full manager day-in-the-life research
- [../synthesis.md](../synthesis.md) — the unified signal model + tiered storage + AI query layer architecture
- [../dictionary.md](../dictionary.md) — the 12-tool source dictionary
