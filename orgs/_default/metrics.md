# Metrics — What This Dashboard Actually Tracks

> Drawn from a representative customer case (`GTM Engineer Case.pdf` and `GTM Engineer Case Context.pdf`). Every metric here is either explicit in the case or directly implied by the strategic priorities. Nothing invented.
>
> **Product spec context:** This doc is the workspace-level instantiation of measurement for the broader Dugout product. Generic product vision: [`dugout_product_spec_v_0_1.md`](../../../dugout_product_spec_v_0_1.md). Spec §12 confirms the customer's priorities (Budget Approval Risk, Finance/IT Engagement Sequencing, Trial Execution SLA as P0 modules); the SV Health Score formula below is the measurement layer on top of those modules.

> **Framing note:** This doc is the **backstop**, not the lead demo pitch. The demo leads with the *story* — "no AE walks into a meeting cold" — and the *artifacts* (live Granola integration, unified drawer, paste-and-sync onboarding). These formulas are here for the moment a Director of Finance or RevOps Lead asks "and how would you measure whether this is working?" — at which point you have a numerical answer with weights, source signals, and a worked example. Do not lead with the formula. Lead with the artifact.

---

## The numbers the case literally publishes

The customer case provides five specific numerical anchors. These are the metrics the CEO, SVP Revenue, Director of Finance, and RevOps Lead (the customer's executive stakeholders) will measure us against.

| Anchor | Source in case | What it tells us |
|---|---|---|
| **ARR $7M → $15M by EOY 2026** | §1 The Business | Need ~$8M net new ARR. At $90k avg ACV, that's **~89 net new closed-won deals** in ~18 months. ~5 deals/month team-wide. |
| **Average ACV ~$90k (range $20k–$400k)** | §1 The Business | $400k upper bound means enterprise deals exist; those are the RFP-driven 6-12 month cycles. Hero deals worth disproportionate attention. |
| **Intro → Qualified: ~37%** | §3 Funnel Stages | Lower than ideal. Either inbound quality or qualification rigor. Top-of-funnel hygiene metric. |
| **Demo Sat → Evaluating: ~64%** | §3 Funnel Stages | Decent. Demo quality is OK; not the wedge. |
| **Selected Vendor → Close: ~60%** | §3 Funnel Stages + case quote: *"Deals that reach here are dying at budget approval."* | **This is the entire interview.** 40% of post-champion deals dying at the procurement gate. Every Dugout feature points here. |
| **AEs spend 70%+ of time in customer conversations** | Priority #3 | The only explicit non-funnel target in the case. The rep-productivity metric. |

**Missing conversion rates we'd need from the customer to complete the funnel:**
- Qualified → Demo Sat
- Evaluating → Selected Vendor

Both should be high if the trial motion (Priority #1) works. Tracking them is a Phase 2 ask.

---

## The math: what moving Selected Vendor → Close from 60% → 70% is worth

Back of envelope, conservative:

- Net new ARR needed: $8M
- At current 60% Selected Vendor → Close: every $1 in Selected Vendor pipeline yields $0.60
- At 70%: every $1 in Selected Vendor pipeline yields $0.70 — **a 16.7% lift on the same pipeline**
- For the $8M target: a 10pp improvement at the SV gate ≈ **~$1.3M in recovered ARR per year** without adding a single new opportunity at the top of the funnel

That's the dollar-weighted version of the interview pitch. **Dugout's job is to move the 60% number.**

---

## The hero metric: Selected Vendor Health Score

The dashboard has one composite score that the CEO can glance at, the SVP Rev can drill into, and the AE can act on. Each open opportunity in Selected Vendor or later gets a **0–100 score**, refreshed daily, with the contributing signals exposed inline.

### Definition

```
SV Health Score = weighted sum of 5 components, all 0–100:

  (0.20 × Time-in-stage score)
+ (0.30 × Buying-committee coverage score)
+ (0.20 × Enablement-asset deployment score)
+ (0.20 × Champion engagement score)
+ (0.10 × Risk-correlation penalty)
```

Tiered output:
- **80–100** Healthy (green) — keep doing what you're doing
- **60–79** Watch (yellow) — surface in the AE's daily delta
- **40–59** At Risk (orange) — surface in the manager's risk-ranked list + AE Slack DM
- **<40** Critical (red) — auto-create BLOCKING task with suggested play

### Component definitions

#### 1. Time-in-stage score (20%)
`max(0, 100 × (1 - days_in_stage / p75_historical_days_in_SV))`

- p75 = the 75th percentile of historical Selected Vendor duration for won deals (need ~30 days of SFDC history to compute)
- Days at p75 = score of 0. Half of p75 = score of 50. Just entered = score of 100.
- **Why p75 not p50:** half of won deals take longer than median; we don't want to alarm at median.

**Signals that feed it:** Salesforce `OpportunityHistory.NewValue='Selected Vendor'` + `CreatedDate`.

#### 2. Buying-committee coverage score (30% — heaviest weight, because Priority #4)
`(distinct_roles_engaged / 5) × 100`

- Required roles: `{Champion, Economic Buyer, Finance, IT/Security, Legal}`
- "Engaged" = the person has done ANY of: opened a Dock asset, attended a Gong call, replied to an Outreach mailing in last 14d
- All 5 engaged = 100. Only Champion = 20. Champion + EB = 40.
- **Why this weight:** Priority #4 literally says *"Get Finance and IT involved during Evaluation, not Contracting."* The case is telling us this is the highest-leverage thing to measure.

**Signals that feed it:** SFDC `OpportunityContactRole` + `Contact.Title` (role classification) + Dock asset views + Gong call participants + Outreach mailing replies.

#### 3. Enablement-asset deployment score (20% — because Priority #2)
`(assets_shared / 3) × 100`

- Three assets per Priority #2: CFO Leave-Behind, IT Zero Lift one-pager, Finance Meeting Brief
- "Shared" = lives in the Dock deal room AND has been viewed at least once by a non-workspace email
- All 3 shared and viewed = 100. None shared = 0.
- **Why this exists as its own metric:** Priority #2 explicitly says *"Assets are built. The active work is adoption and AE habit formation."* Adoption rate IS the metric.

**Signals that feed it:** Dock asset existence + Dock asset view events by external viewers.

#### 4. Champion engagement score (20%)
`max(0, 100 × (1 - days_since_any_champion_touch / 14))`

- Champion = `OpportunityContactRole.IsPrimary = true` person
- "Touch" = visited Dock room, attended Gong call, replied to Outreach, opened HubSpot email click
- 0 days = 100. 7 days = 50. 14+ days = 0.
- **Why 14 days:** the persona research said reply-latency baseline of <24h is normal; >5d is concerning; 14d is dead.

**Signals that feed it:** Dock visits + Gong attendance + Outreach replies + HubSpot email engagement — all the `champion_disengagement` signal sources from the synthesis taxonomy.

#### 5. Risk-correlation penalty (10%, subtractive)
Subtract 20 points from the running score if any of these active correlations exist on the opp:
- `champion_loss` correlation (≥2 sources agreeing in last 14d)
- `committee_gap` correlation (≥2 sources agreeing)
- `competitive_threat` correlation with a verified Gong-tracker hit
- `momentum_change` correlation (no next step + close-date slip + reschedule)

Floor at 0.

**Why subtractive not additive:** the absence of these is normal; their presence is the alarm.

### Worked example

Helios Manufacturing, $185K, in Selected Vendor for 23 days, p75 = 30 days:

- Time-in-stage: 100 × (1 - 23/30) = **23** (×0.20 = 4.6)
- Committee coverage: Champion + EB engaged, Finance/IT/Legal silent = 2/5 = **40** (×0.30 = 12.0)
- Enablement: CFO Leave-Behind shared (viewed) + IT one-pager shared (not viewed) + Finance Brief never sent = 1/3 = **33** (×0.20 = 6.6)
- Champion engagement: last touch 9 days ago = 100 × (1 - 9/14) = **36** (×0.20 = 7.2)
- Risk correlation: `champion_disengagement` correlation active (3 sources) → -20

Score: 4.6 + 12.0 + 6.6 + 7.2 - 20 = **10.4 → Critical (red)**

Display: **"Helios — 10/100 Critical. Champion engagement decaying (9d silent), Finance/IT/Legal never engaged, Finance Brief not sent."** Click → see all contributing signals with timestamps and source webhooks.

### Why this formula is defensible in the interview

- **Every weight is tunable** — when a panel pushes back ("why is committee 30% not 25%?"), you say *"that's a tuning knob. It's 30% because Priority #4 names committee engagement as the highest-leverage problem. RevOps can dial it per-quarter as the data comes in."*
- **No ML** — every score is a closed-form computation, instantly explainable, debuggable in SQL
- **Every input traces to a source webhook** — your traceability principle, end to end
- **The output is one number** — the CEO can ask "what's our average SV Health this week vs last" and get an answer

---

## The full metric catalog — by strategic priority

| # | Priority (verbatim from case) | Headline metric | Contributing signal_types |
|---|---|---|---|
| **#1** | Outcome-First Trial Motion (*"highest-leverage change in H1"*) | % of Evaluating+ deals with active trial within 48h of stage entry | Salesforce stage entry + Dock trial workspace creation + SE intake form |
| **#2** | Finance + IT Enablement Package (*"active work is adoption"*) | % of Selected Vendor deals with all 3 assets shared AND viewed by buyer | Dock asset upload events + Dock asset view events filtered to non-workspace domains |
| **#3** | AI-Powered Deal Execution Stack (*"AEs spend 70%+ of time in customer conversations"*) | (a) % AE time in customer conversations; (b) % Evaluating+ deals with Dock room + Gong configured | Gong call time + calendar API + Outreach admin time + Dock + Salesforce custom field |
| **#4** | Stakeholder Engagement Sequencing (*"get Finance and IT involved during Evaluation, not Contracting"*) | **Time from Evaluating stage entry → first Finance touch + first IT touch** (separately tracked) | SFDC OCR additions + Gong call participants (title-classified) + HubSpot new contact creation + Chili Piper meeting attendees |
| **#5** | Sales Motion Maturity | (a) Multithreading depth — avg distinct contacts engaged per opp by stage; (b) RFP win rate; (c) execution checklist completion | SFDC OCR count + Gong external participants + Outreach prospect breadth |
| **#6** | ABM | % pipeline ARR from named accounts; ABM-sourced ACV | SFDC custom flag + ZoomInfo intent + HubSpot account-level engagement |

---

## Operational metrics — the manager/CRO layer

These don't come from the case explicitly but are implied by the team composition (9 AEs / 7 SDRs / 2 SEs / 1 RevOps + SVP Revenue) and the standard B2B SaaS manager toolkit:

| Metric | Why it matters | Source |
|---|---|---|
| **Forecast accuracy** (call vs close, ±5–10% target) | CROs grade VPs on this. Per Gong research, average B2B forecast is off 25%+. | SV Health Score per opp + historical close rates |
| **Pipeline coverage** (3x rule for next quarter) | Standard ratio: $3 of weighted pipe per $1 of quota | SFDC opp data |
| **Days in stage by AE** | Detects sandbagging and stalled deals per rep | SFDC stage history + opp.owner |
| **Multithreading depth by AE** | Per Priority #5; correlates with win rate per Gong research | SFDC OCR count per opp.owner |
| **Rep ramp progress** (months 1-6) | Median ramp = 5 months per Bridge Group; managers carry retention risk | SFDC activity + first-deal close per rep + hire date |
| **Per-rep call themes** (objections, discovery quality) | Coaching prep input | Gong tracker hits per rep |

These power the manager-side surfaces (Risk-Ranked Deal List, Per-Rep Coaching Brief, Forecast Confidence Panel) per `discovery/information-requirements.md`.

---

## Traceability — the load-bearing principle

Every metric on the dashboard must answer: *"Why is this number what it is, and which source webhook(s) produced the underlying signal?"*

Click path on any score:
1. **Metric tile** → see contributing component scores
2. **Component score** → see the signals that fed it
3. **Signal** → see source_tool, source_event_id, occurred_at, raw payload
4. **Raw payload** → click into source system (Gong call, Dock room, SFDC opp, Outreach mailing) at the exact event

This is non-negotiable because:
- Trust — AEs and managers must be able to verify before they act
- Debugging — when a score is wrong, you can find the bad signal
- Defensibility — *"why did Dugout flag this deal?"* has a real answer
- Compliance — audit trail per signal

The schema in `synthesis.md` was designed for exactly this: every `signals` row carries `source_tool` + `source_event_id`; every `signal_correlations` row carries an array of contributing `signal_ids`.

---

## Part 2 — the proposed second system (writes itself)

The case asks for a second GTM system to propose alongside Dugout. **Strategic Priority #1 is explicitly labeled the "highest-leverage change available in H1"** and it's not a deal intelligence problem — it's a workflow problem:

> *"Deploy a outcome based trial on every Evaluating+ deal before the next meeting. AE requests intake data; SE returns a KPI Assessment and pre-seeded demo in 48 hours."*

This is **Trial Intake Orchestrator** — a separate system from Dugout:

- **Input:** AE submits intake form when opp moves to Evaluating (or on demand)
- **Routing:** auto-assigned to next available SE (round-robin or by industry/segment)
- **SLA tracking:** 48h countdown clock per intake; escalation if missed
- **Output:** SE returns KPI Assessment + pre-seeded demo, attached to the Dock deal room
- **Closeout:** trial → Selected Vendor conversion tracked as the success metric

**Why it earns Part 2 slot:**
- Case explicitly labels Priority #1 as highest-leverage
- It's a different system shape (workflow + SLA, not signals + dashboards) — shows you can reason about both
- It compounds with Dugout: trial deployment becomes a measurable input to SV Health Score
- The handoff already flagged "Trial Orchestrator" as the companion product to Dugout

Don't deep-dive — Part 2 should be lightweight per the case instructions. One slide: *"AE intake form → SE queue → 48h SLA → Dock-attached output. Feeds Dugout as a Priority #1 metric."*

---

## What we'd want to validate with the customer (interview questions)

The case literally tells us to "bring questions." Here's the metrics-anchored list:

1. *"You publish Intro→Qualified at 37%, Demo Sat→Evaluating at 64%, and Selected Vendor→Close at 60%. What's Evaluating→Selected Vendor today, and what's your target for that gate over the next 6 months?"*

2. *"Your Selected Vendor → Close is 60%. What's the dollar value of a 10-point improvement at that gate, and how would you measure it?"* (Then quote your $1.3M back-of-envelope.)

3. *"Priority #4 says 'get Finance and IT involved during Evaluation.' What's the current median time from Evaluating entry to first Finance contact? Because that's the metric I'd put at the top of the dashboard."*

4. *"Priority #2 says assets are built and the work is adoption. What's the current % of Selected Vendor deals with all 3 enablement assets actually shared? My guess is below 30%."*

5. *"You list 70% AE time in customer conversations as the Priority #3 target. What's the current baseline?"*

6. *"You're moving Chorus → Gong. When does that complete? Building against Gong vs Chorus is a real choice."*

7. *"Priority #6 names ABM as a gap. Is named-accounts pipeline tracked today, or is it something Dugout would be the first system to measure?"*

---

## See also

- `dictionary.md` — the 12 source tools with the signals each emits
- `tools/*.md` — per-tool dictionaries with API specifics
- `synthesis.md` — the unified signal model + tiered storage + AI query layer
- `discovery/information-requirements.md` — UX surface prioritization (the SV Health Score is **Hero Surface #0** there)
- `discovery/ae-workflow.md`, `discovery/manager-workflow.md` — persona research the surfaces are designed for
