# Sales Manager Workflow — Day/Week/Month + Information Requirements

## Persona snapshot
Frontline Sales Manager / Director of Sales at a Series B/C B2B SaaS company, managing 6–10 AEs (Checkbox: 9 AEs, likely split under one VP or two Directors). Measured on **team quota attainment, forecast accuracy (call vs. close within ±5–10%), new-rep ramp time, and rep retention** — not personal closes. Lives in dashboards and 1:1s, not deal-running. Drowning in tools (Salesforce, Gong, Outreach, ZoomInfo, Chili Piper, Dock, Nooks, Swyft, HubSpot, Zendesk) and optimizes for **signal-to-noise**: which 10 deals matter this week, which rep needs coaching, will I make my number. Unlike an AE — who goes deep on 15–25 active opps — a manager scans 80–150 opps weekly for **outliers and patterns**.

## A typical day
- **7:30–8:30am** Coffee + inbox + scan overnight Slack channels (deal-alert, won/lost). Glance at forecast delta vs. yesterday.
- **8:30–9:30am** Pipeline scrub or stand-up. Which deals slipped a stage? Which went dark? Pull up Gong deal board, look for missing next-step dates.
- **9:30–11am** Two back-to-back AE 1:1s. Ideally pre-listened to 1–2 calls per rep (Gong research: managers who listen to ≥2 calls/week/rep see ~20% higher attainment on that rep).
- **11am–12pm** Deal escalation — AE pings about a pricing exception or legal redline; manager pulls deal context, checks Dock engagement, decides whether to loop in CRO/legal.
- **1–3pm** Forecast roll-up prep (Thursday) or marketing sync (Wednesday) or interview loop (always).
- **3–4:30pm** More 1:1s or live call shadowing.
- **4:30–6pm** Admin: comp questions, Salesforce hygiene nag, async exec update.
- **Evening** Sunday-night dread: prepping the Monday pipeline review deck. This is the universally hated 60–90 min that Dugout should kill.

Pavilion and Gong both report managers spend **60–70% of their week in meetings**, leaving ~15 hours for actual coaching and analysis — most of which is consumed by stitching reports together.

## A typical week
- **Monday** Team pipeline review (60–90 min). Goes deal-by-deal on top 10–15 opps. Information needed: deal health, last activity, next step, competitor, champion status, procurement stage.
- **Tuesday** 1:1s with each AE (30–45 min each). Information needed: rep's pipeline coverage, call themes, sequence reply rates, lost-deal reasons, ramp progress for newer reps.
- **Wednesday** Cross-functional — marketing pipeline review (source attribution, MQL→SQL conversion), CS handoff sync (renewals at risk, expansion signals).
- **Thursday** Forecast call up to VP/CRO. The big one. Manager commits a number. Information needed: stage-weighted pipeline, historical slip rate, deal-specific risk flags, coverage for next quarter.
- **Friday** Deal desk (pricing/legal exceptions), win/loss review of deals that closed that week, EOM/EOQ push if applicable.

## A typical month/quarter
- **Forecast accuracy review** vs. what was called (the metric).
- **Ramp tracking** for reps in months 1–6 — milestones, first-deal close, activity benchmarks. The Bridge Group says median B2B SaaS AE ramp is 5 months; managers carry retention risk if a rep isn't tracking by month 4.
- **Comp & territory rebalancing** quarterly — who's overloaded, whose patch is underperforming.
- **Win/loss analysis** — cohort-level: why are we losing at Selected Vendor? Which competitor? Which segment?
- **QBR prep** to CRO — narrative + numbers.
- **Hiring** — interview loops, backfill planning.

## Information lookups: what they need, when, where they get it today

### 1. Pipeline review prep
- **Trigger:** Sunday night / Monday 8am before team review
- **Question:** "Which 10 deals do I need to dig into this week?"
- **Today:** SFDC report → Gong deal board → Slack DMs to AEs
- **Friction:** 90 min, stale activity data, blind to deals where AE hasn't logged bad news
- **10x:** Ranked risk-elevated deal list with cross-source evidence (call sentiment + dock silence + missing next step)

### 2. Rep coaching prep
- **Trigger:** Before each 1:1
- **Question:** "What pattern is hurting this rep? Objection handling? Discovery? Multi-threading?"
- **Today:** Manually skim 2–3 Gong calls, eyeball stage conversion in SFDC
- **Friction:** Cherry-picking; no aggregated view of *this rep's* call themes vs. team avg
- **10x:** Per-rep call-theme dashboard — top objections, talk ratio, discovery question count, vs. peer benchmark

### 3. Forecast call prep
- **Trigger:** Wed night before Thursday forecast call
- **Question:** "What's my real commit and where am I exposed?"
- **Today:** SFDC forecast tab + spreadsheet + gut
- **Friction:** Reps inflate; manager has no independent signal
- **10x:** Auto deal-grade per opp using actual engagement signals, not just stage

### 4. Exec escalation
- **Trigger:** CRO Slacks "what's going on with Acme?"
- **Question:** "Give me the 30-second state of this deal — last touch, blockers, $$, close date confidence"
- **Today:** Pivot through SFDC, Gong, Dock, Slack — 10–15 min scramble
- **10x:** One-page deal brief on demand

### 5. AE 1:1 prep — pipeline coverage
- **Question:** "Does this rep have 3x coverage for next quarter?"
- **Today:** SFDC report filtered by owner
- **Friction:** Doesn't account for stale opps or historical close rate by rep
- **10x:** Rep-specific weighted coverage with quality score

### 6. Deal desk review
- **Trigger:** Friday pricing/legal exception requests
- **Question:** "Is this discount justified by deal size + strategic value + competitive pressure?"
- **Today:** Email thread + SFDC opp notes
- **10x:** Auto-attached competitor mentions, procurement-stage evidence, comparable closed deals

### 7. Win/loss analysis
- **Trigger:** Monthly / quarterly
- **Question:** "Why are we losing at Selected Vendor stage and to whom?"
- **Today:** Manual reading of closed-lost notes
- **10x:** Auto-clustered loss reasons with linked Gong moments

### 8. Hiring/ramp tracking
- **Trigger:** Weekly check on ramping reps
- **Question:** "Is this rep on the ramp curve? Should I worry?"
- **Today:** Spreadsheet vs. ramp milestones
- **10x:** Auto activity + first-deal milestones vs. team historical median

### 9. Marketing source ROI
- **Trigger:** Wednesday marketing sync
- **Question:** "Which sources actually close, not just convert to SQL?"
- **Today:** HubSpot → SFDC manual join
- **10x:** Source → closed-won attribution with cycle time

### 10. Competitive pressure scan
- **Trigger:** Ongoing
- **Question:** "Are competitor X mentions trending up across the team?"
- **Today:** Nope. Vibes.
- **10x:** Aggregated competitor mention frequency from Gong, trended

## Decisions a manager makes

| Decision | What they need | Freshness | Cost of wrong |
|---|---|---|---|
| Will this deal close this quarter? | Cross-source deal health + signal history | Same day | Blown forecast, CRO credibility |
| Which rep needs coaching on what? | Aggregated call themes by rep vs. benchmark | Weekly | Rep attrition, ramp delay |
| Do we have Q+1 coverage? | Stage-weighted pipeline + velocity | Weekly | Panic hiring, panic discounting |
| Approve this discount? | Deal context + comparable deals | Same hour | Margin leak |
| Escalate to CRO or hold? | Deal health + value + risk | Same day | Surprise loss |
| Pull a deal from forecast? | Engagement decay evidence | Same day | Wasted commit |
| Reassign a territory? | Rep capacity + opp quality | Quarterly | Morale + revenue dip |
| Hire or wait? | Coverage gap + ramp pipeline | Monthly | 6-month delay |
| Fire/PIP a rep? | Activity + outcome + coachability data | Quarterly | Legal + morale |

## Patterns managers care about that AEs don't
- "Are we losing more at Selected Vendor than last quarter? Why?"
- "Which AE's deals have the cleanest deal-room and multi-threading?"
- "Are competitor X mentions rising across the team or just one rep?"
- "Which marketing source produces deals that actually close?"
- "What's the median time from Selected Vendor → Closed Won this quarter vs. last?"
- "Which deal sizes have the highest slip rate?"
- "Are reps with high talk ratio winning less?" (Gong's famous 46/54 listen-talk research)

## What managers WANT but can't easily find today
- Real, signal-driven deal grades independent of AE sandbagging/sandcastling.
- Cohort-level Selected-Vendor stall reasons.
- Per-rep call-pattern fingerprint vs. top performer.
- Pipeline-quality trend (not just $ — *quality*).
- Early-warning list of deals likely to slip 14 days before they do.

## Forecast accuracy — the highest-leverage problem
Gong's research: roughly half of forecasted deals slip or go no-decision; the average B2B forecast is off by 25%+. CROs grade VPs on call-vs-close variance. The synthesis.md schema is **purpose-built** for this: `procurement_stage_change`, `meeting_no_show`, `dock_engagement_decay`, `champion_silence`, `competitor_mention`, and `legal_redline_received` are exactly the leading indicators that separate slip from close. A weighted deal-grade model fed by these signal_types — refreshed daily — is the killer manager feature. Specifically: any opp in commit/best-case with **>14 days of dock_engagement_decay AND no procurement_stage_change** should auto-flag as slip risk. That single rule probably catches 30%+ of slips invisible to current SFDC forecasts.

## Anti-requirements (noise to a manager)
- Individual email opens / sequence-step pings (AE-level).
- Per-call transcripts (managers want themes, not full text).
- Inbound MQL volume without conversion lens.
- Activity-for-activity's-sake leaderboards (dials, emails sent) — correlate poorly with attainment.
- Tool-by-tool dashboards that don't roll up to deal or rep.

## Gap analysis vs. synthesis.md
- ✅ Deal-level risk signals — `procurement_stage_change`, `dock_engagement_decay`, `competitor_mention`, `champion_silence`, `meeting_no_show`, `legal_redline_received` all map cleanly.
- 🔧 **Aggregation layer needed:** per-rep rollups, cohort rollups (by stage, segment, source, competitor), trend over time. The schema has the atoms; needs cohort/window queries.
- 🔧 **Deal-grade model:** weighted scoring across signal_types — derived, not stored.
- 🔧 **Call-theme clustering** per rep (objection types, discovery quality) — needs NLP layer on Gong signals.
- 🚫 Ramp curves vs. historical median — needs HRIS/start-date data not in current scope.
- 🚫 Comp/territory modeling — out of scope.

## Top 3 questions a manager would ask the AI assistant first
1. "Which 10 deals in my team's pipeline are most likely to slip this quarter, and why?"
2. "What objection is Sarah losing on most, and which Gong moments should I review with her?"
3. "Compared to last quarter, where in the funnel are we leaking, and is it one rep or systemic?"

## Top 3 information surfaces that change manager behavior
1. **Risk-ranked deal list** — daily refreshed, evidence-backed, the death of the Sunday-night SFDC scrub.
2. **Per-rep coaching brief** — auto-generated before each 1:1: call themes, objection patterns, deal-hygiene gaps, vs. team benchmark.
3. **Forecast confidence panel** — every committed deal shows a signal-driven grade with the 2–3 signals driving it; manager sees their real exposure.

## AE view vs. Manager view in the product
**Same data, different lens:**
- AE sees *their 15–25 deals*, deep, with next-action recommendations.
- Manager sees *all team deals*, ranked by risk, with rep-attribution.

**Different data entirely:**
- Manager-only: cohort rollups, per-rep benchmarks, forecast confidence aggregates, win/loss clustering, call-theme trends, marketing-source close attribution.
- AE-only: personal next-step prompts, sequence performance, individual call self-review.

**UX implication:** AE view is opp-centric (vertical: one deal deep). Manager view is portfolio-centric (horizontal: many deals wide, with drill-down). Both pull from the same signal_type tables — the manager view is fundamentally an aggregation + ranking layer over the AE view.
