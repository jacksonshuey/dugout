# Information Requirements — AE + Manager Synthesis

> What the people who'd use Dugout actually need, when, in what shape. Synthesizes [ae-workflow.md](ae-workflow.md) and [manager-workflow.md](manager-workflow.md). Becomes the spec for the UX surfaces built on top of [../synthesis.md](../synthesis.md).

## The one-line read

**Same underlying data, two fundamentally different lenses.** AE work is *opp-centric* (one deal deep, next-action driven). Manager work is *portfolio-centric* (many deals wide, pattern-driven). Every backend signal serves both — what differs is the *view*.

This means the build order is: ship the signal model (synthesis.md) once → render two views on top.

---

## What both personas independently demanded

Both the AE and the Manager research surfaced the same root needs in different language. This convergence is the strongest signal that the synthesis.md schema is right.

| Need | AE language | Manager language | Backend signal_type |
|---|---|---|---|
| Detect dying late-stage deals | "Selected-Vendor Procurement Tracker" | "Risk-ranked deal list" | `committee_gap` + `champion_disengagement` + `momentum_stall` |
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
| `meeting_no_show` | `momentum_stall` |
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

## The 6 prioritized UX surfaces

Three per persona, ranked by behavioral impact. **Surfaces 1 and 4 share the same backend** — Pre-Call Brief is "one opp deep"; Risk-Ranked List is "all opps wide." Ship them together.

### AE surfaces

**1. Pre-Call Brief** *(highest AE behavioral impact)*
- **Trigger:** auto-rendered 15 min before any external calendar event
- **Content:** who's attending, role classification, what each person has touched (calls, emails, doc views, last login to Dock), what changed since last contact, top 3 risks, suggested opener
- **Replaces:** 5-8 min of tab-juggling across SFDC/Gong/LinkedIn/ZoomInfo/Dock
- **Backend:** `get_account_context()` + `get_account_timeline()` + `get_committee_engagement()` tools from the AI query layer
- **First demo moment:** "Sarah opens Slack at 9:15am, sees the brief for her 9:30 call, reads it in 60 seconds, walks in armed"

**2. Selected-Vendor Procurement Tracker** *(highest wedge alignment — the Checkbox-specific killer feature)*
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

| Phase | Ships | Why this order | Effort |
|---|---|---|---|
| **Phase 0** (already done) | dictionary.md + synthesis.md + tools/* | Foundation, no UX | done |
| **Phase 1** | Tiered storage + `/account/[slug]` route (the unified timeline view) | Single deepest-evidence view — the substrate for everything | ~3 days |
| **Phase 2** | Pre-Call Brief + Risk-Ranked Deal List | Shared backend; both personas get high-impact surface; lands the wedge story | ~2 days (after Phase 1) |
| **Phase 3** | `/ask` route with 6 prefilled questions | The "free-flowing hub" framing made concrete | ~3 days |
| **Phase 4** | Procurement Tracker | Wedge made *visible* — the Checkbox-specific killer feature for the interview | ~1.5 days |
| **Phase 5** | Daily Deal Delta (Slack) + Per-Rep Coaching Brief | Habit-forming + manager-side adoption | ~2 days |
| **Phase 6** | Forecast Confidence Panel | Stretch — the highest-ceiling feature but most accuracy risk | ~3 days |

**Total: ~14.5 days** if every adapter were already wired. Realistically, since the *backend signals* feeding these surfaces don't all exist yet, Phase 1-4 is the demoable scope.

---

## For the Checkbox interview specifically — the minimum to demo

If you have only ~1 week of build time before the interview, ship:

1. **`/account/[slug]` route** (Phase 1) — the deep timeline view. Renders fake data from `src/data/seed.ts` augmented with synthesized signals. Proves the unified-store concept.
2. **Procurement Tracker** (Phase 4) — the wedge made visible. The single most defensible artifact for *Checkbox specifically*.
3. **`/ask` route** (Phase 3) with one working question: "Why is {seedAccount} stalling?" — Sonnet 4.6 answer with citations into the timeline.

That's three surfaces, ~5 days of focused work, and a demo arc that goes:
- "Here's the data architecture" (synthesis.md slide)
- "Here's the timeline view of one account" (`/account/[slug]`)
- "Here's the wedge-specific surface that catches dying deals 2 weeks early" (Procurement Tracker)
- "Here's the AI layer that lets anyone ask anything across the stack" (`/ask` live demo)

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

- [ae-workflow.md](ae-workflow.md) — full AE day-in-the-life research
- [manager-workflow.md](manager-workflow.md) — full manager day-in-the-life research
- [../synthesis.md](../synthesis.md) — the unified signal model + tiered storage + AI query layer architecture
- [../dictionary.md](../dictionary.md) — the 12-tool source dictionary
