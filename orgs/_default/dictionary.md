# Workspace — Signal Dictionary (Index)

> The structured catalog of what Dugout knows about the workspace's world. Per-tool details live in `tools/*.md`.
> - **The metrics this all powers (Selected Vendor Health Score + case-derived numbers):** [metrics.md](metrics.md) *(backstop, not the lead pitch)*
> - **The unified relational model + tiered storage + AI query layer:** [synthesis.md](synthesis.md)
> - **AE + Manager workflow research + UX prioritization:** [discovery/](discovery/) — start with [information-requirements.md](discovery/information-requirements.md)
> - **What to build next beyond the workspace's stack:** [../../docs/gtm-tool-expansion-research.md](../../docs/gtm-tool-expansion-research.md) *(Dugout-wide roadmap; identifies G2 Buyer Intent, Common Room, real Gong API as the next must-haves)*

> **Where this fits in the broader product:** this dictionary is the **workspace-specific instantiation** of the Dugout product spec at [`../../dugout_product_spec_v_0_1.md`](../../dugout_product_spec_v_0_1.md). The spec defines the universal source taxonomy (§6), canonical objects (§4), and signal model (§7); this file is what those abstractions look like when grounded in the workspace's actual 14-tool stack and a Selected Vendor wedge. New tools added here should also live somewhere in spec §6 — if they don't, one of the two docs is behind.

## What this is

A "dictionary" in Dugout's sense is **not** a glossary of terms. It is the structured contract between the workspace's operating systems (the 14 tools below + the live-world feeds Dugout already ingests) and Dugout's signal engine. Each entry answers:

- *What data does this source emit?*
- *Which 2–4 signals from it actually move the needle?*
- *What rule consumes the signal? At what severity tier?*
- *What's the realistic cost to wire it?*
- *What would we ignore — and why?*

The dictionary is read by humans (sales ops authoring playbooks, AEs understanding why a task fired) and by the engine (rules, the morning digest LLM, the orchestration layer).

---

## The broader product, and where the wedge sits inside it

**The product (per HANDOFF §3.5):** *a centralized intelligence layer for sales teams — no AE walks into a meeting cold.* Every tool, every signal, every news cycle and vertical trend, synthesized so neither the AE nor their manager is operating blind.

**The wedge is the demo anchor, not the whole product.** For this workspace, deals die at **Selected Vendor** — the gap between verbal champion buy-in and procurement/finance/IT/legal approval. That's the customer-aligned story used in the demo. The architecture below applies whether the customer's pain is "Selected Vendor stalls" or "Series A founders going dark in week 6" (a different ICP). The signals are universal; the *priority weighting* is per-customer.

Every signal in this dictionary is graded on: *does it shorten the time between "thing happens on the buyer side" and "AE knows about it"?*

Severity tiers:

| Tier | Routing | Latency target |
|---|---|---|
| **BLOCKING** | Slack DM to AE owner | < 1 hour |
| **ACTION** | Today's task list in the console | < 24 hours |
| **AWARENESS** | Weekly digest entry | < 7 days |

---

## The 14 internal operating systems

12 from the customer's stack + **Granola** (added session 5, the only one wired end-to-end) + **Slack** (added on this pass per product spec §6.3 and §12.2 — missed in the original list).

| Tool | Category | Signals | Top tier | Wedge fit | Wire effort |
|---|---|---|---|---|---|
| [Salesforce](tools/salesforce.md) | CRM (system of record) | 4 | BLOCKING | S — anchor | ~280 LOC / 6-8h sandbox |
| [HubSpot](tools/hubspot.md) | Marketing automation | 4 | BLOCKING | A — buying-committee shadow research | ~350 LOC / 1.5d |
| [Outreach](tools/outreach.md) | Sales engagement | 3 | BLOCKING | A — champion latency decay | ~350 LOC / 1.5d |
| [ZoomInfo](tools/zoominfo.md) | Prospecting / intent | 4 | BLOCKING | S — feeds existing Champion Departure playbook | ~250 LOC / 1.5d |
| [Gong](tools/gong.md) | Conversation intelligence | 4 | BLOCKING | S — only source of "no next step committed" | ~450 LOC / 2-3d |
| [Chili Piper](tools/chili-piper.md) | Meeting scheduling | 3 | BLOCKING | B — reschedule streaks, committee expansion | ~180 LOC / 3h |
| [Dock](tools/dock.md) | Deal rooms | 5 | BLOCKING | **S+ — flagship; only source of late-stage silence detection** | ~250 LOC SF-relayed / ~400 LOC direct |
| [Nooks](tools/nooks.md) | AI-assisted calling | 3 | ACTION | C — SDR-stage, secondary | ~100 LOC / 0.5d |
| [Swyft AI](tools/swyft-ai.md) | AI deal capture | 3 (indirect) | BLOCKING | A (as upstream enabler, not signal source) | 0 net new LOC |
| [Zendesk](tools/zendesk.md) | CS / support | 3 | BLOCKING | B — expansion plays + reference health | ~250 LOC / 1.5d |
| [Webflow](tools/webflow.md) | Website / CMS | 2 standalone, 1 layered | ACTION | C — low standalone, depends on de-anon layer | ~120 LOC / 2-3h |
| [Xero](tools/xero.md) | Finance / billing | 4 | BLOCKING | B — retention/renewal wedge (downstream) | ~450 LOC / 2-3d |
| [**Granola**](tools/granola.md) | **Meeting notes (live in Dugout)** | **7** | **BLOCKING** | **S — `finance_mentioned_not_engaged` is the literal wedge signal** | **0 (already built end-to-end, session 5)** |
| [Slack](tools/slack.md) | Team comms (internal handoff + flagging) | 4 | BLOCKING | B — internal handoff completeness; corroborating evidence not primary | ~280 LOC / 1.5-2d |

**Totals:** 53 signals across 14 tools. ~15 BLOCKING-tier, ~23 ACTION-tier, ~15 AWARENESS-tier. Granola is built; the other 13 are deeply researched but not wired.

> **Granola matters disproportionately as a card** because it's the only one with shipping code — it documents the **canonical pattern** (REST adapter → Haiku classifier → Supabase Vault for the API key → daily cron sync → drawer surface) that every other adapter in this dictionary will follow.

### Tier S (wedge anchors — wire first)

- **Granola** *(actually live)* — `finance_mentioned_not_engaged` and `it_mentioned_not_engaged` are the most direct signals for the Selected Vendor wedge in the entire dictionary. Already shipping.
- **Dock** — the only system in the stack that sees who from the buying committee is *actually reading* the late-stage assets. No substitute.
- **Gong** — only source of "no committed next step" and verified competitor mentions. Critical for the Selected Vendor → procurement transition.
- **Salesforce** — system of record. Every other adapter joins back through it.
- **ZoomInfo** — directly feeds the already-built Champion Departure playbook.

### Tier A (high leverage — wire second)

- **HubSpot** — shadow research from buying-committee members not on the OCR.
- **Outreach** — champion reply latency decay.
- **Swyft AI** — not a signal source, but the upstream that makes Salesforce-based MEDDPICC rules viable.

### Tier B (extends scope to retention/expansion)

- **Chili Piper** — momentum signals (reschedules, no-shows, new-persona meetings).
- **Zendesk** — expansion-deal account-health degradation, champion-filed-angry-ticket.
- **Xero** — renewal windows, payment health, quiet downgrades.
- **Slack** — internal handoff completeness, rep-flagged risk that hasn't hit CRM yet, customer-channel silence. Tier B because three of four signals are corroborating; the one exception (`handoff_requested_no_completion`) is BLOCKING because no other tool sees dropped internal handoffs.

### Tier C (low standalone, defensible as adapter stubs)

- **Nooks** — SDR-stage; account-level org-change detection only.
- **Webflow** — CMS without identity; useful only if de-anon layer is added.

---

## Cross-tool patterns: the ontology emerging

The point of the dictionary is not the 14 individual cards — it's the **relationships between them**. Several signals correlate across tools, and *correlated signals are higher-confidence than any single source*. This is where the ontology earns its keep.

### Pattern 1: Champion departure (4 tools converge)

| Source | Signal |
|---|---|
| ZoomInfo | Job change detected (BLOCKING) |
| Salesforce | OpportunityContactRole.Contact.IsActive flipped (BLOCKING) |
| Outreach | Champion email bounced or opted-out (BLOCKING) |
| Nooks | Disposition cluster "no longer here" at account (ACTION) |

**Rule shape:** Any single source = fire. Two sources within 14d = elevate to highest tier + auto-trigger Champion Departure playbook.

### Pattern 2: Buying-committee gap (4 tools converge)

| Source | Signal |
|---|---|
| Salesforce | Missing procurement/legal/IT contact role (ACTION) |
| Dock | Critical asset never opened by Finance/Legal/IT (BLOCKING) |
| Gong | Last 3 calls have no Finance/IT/Legal participant (ACTION) |
| Swyft AI (via SF) | Economic Buyer field empty at Selected Vendor (BLOCKING) |

**Rule shape:** Any two of these on the same opp = BLOCKING + assistant prompt for the AE to build a buying-committee map before next call.

### Pattern 3: Champion disengagement (5 tools converge)

| Source | Signal |
|---|---|
| Dock | Champion stopped visiting deal room ≥7d (BLOCKING) |
| Outreach | Reply latency increased >5d from <24h baseline (BLOCKING) |
| Gong | Sentiment cliff call-over-call (AWARENESS) |
| HubSpot | Lifecycle stage regressed or no opens 30d (ACTION) |
| Chili Piper | 2+ reschedules in 14d (BLOCKING) |

**Rule shape:** Confidence-weighted — 1 source = ACTION, 2 sources = BLOCKING. Drives the "champion is going dark" task with the strongest evidence first.

### Pattern 4: Late-stage competitive threat (3 tools converge)

| Source | Signal |
|---|---|
| Gong | Competitor name tracker hit on Selected Vendor call (ACTION) |
| Swyft AI (via SF) | Competitor field added post-Proposal (AWARENESS) |
| HubSpot | Contact viewed `/vs/<competitor>` page (AWARENESS) |
| Nooks (via SF) | Competitor mention in AI summary (AWARENESS) |

**Rule shape:** Single Gong source = ACTION (verified verbal mention). Two of the lower-confidence sources = ACTION. Three sources = elevate to BLOCKING and trigger competitive-defense playbook.

### Pattern 5: Hidden buying-committee expansion (5 tools converge)

| Source | Signal |
|---|---|
| HubSpot | New contact at account submits high-intent form (BLOCKING if not on OCR) |
| Dock | Unknown viewer from buyer-org domain (ACTION) |
| Outreach | Net-new prospect at account replies (ACTION) |
| Chili Piper | First meeting booked with Finance/Legal/IT persona (AWARENESS) |
| Webflow | High-intent form from new contact at named account (ACTION) |

**Rule shape:** This is a *positive* signal — a new buying-committee member just revealed themselves. Any source = ACTION task to identify and add to OCR within 24h.

### Pattern 6: Pre-meeting intel — `account_context` + `vertical_context` (live-world feeds, no committee data required)

| Source | Signal |
|---|---|
| NewsAPI | Account-named news article in last 30d (AWARENESS, promotes to ACTION on funding/layoffs/exec-change) |
| SEC EDGAR | 8-K filing for the account (AWARENESS, promotes to ACTION on Item 5.02 director/officer change) |
| Inbound newsletter inbox | Vertical-level market intel mentioning account's industry (AWARENESS) |
| Inbound newsletter inbox | Account explicitly named in a newsletter (ACTION) |

**Rule shape:** This pattern doesn't require multi-source correlation — even one item is useful for pre-meeting prep. The product surface is the **"no AE walks in cold"** drawer block on every account, rendered into a Pre-Meeting Brief 15 min before any external calendar event. Powers the broader anti-cold-meeting product, not just the wedge.

**Why this matters for the product framing:** Patterns 1–5 are wedge-focused (deal-state signals about specific opps). Pattern 6 is the *broader product* — the live-world layer that makes Dugout useful even when there's no specific stall to detect. The two work together: Patterns 1–5 catch the dying deals; Pattern 6 prevents reps from walking in cold to *healthy* deals too.

---

## The architectural picture

```
┌─ Internal operating systems (the 14 tools above) ──────┐
│  CRM, marketing, sales engagement, prospecting,        │
│  conversation intel, scheduling, deal rooms, AI calling,│
│  AI deal capture, CS, website, finance                  │
└─────────────────────────────────────────────────────────┘
                          │
                          ↓ adapters write to
┌─ Signal store (Supabase: external_signals) ────────────┐
│  Typed events keyed by (source, account_id, occurred_at)│
│  Existing implementations: NewsAPI, SEC EDGAR, inbound  │
│  email (Mailgun + SendGrid). All 12 above use same shape│
└─────────────────────────────────────────────────────────┘
                          │
                          ↓ feeds
┌─ Ontology (the 4-entity model) ────────────────────────┐
│  Account → Person (Champion/EB/Detractor/Influencer)   │
│  → Initiative (the thing the buyer is trying to do)    │
│  → Signal (anything that updates the state of 1-3)     │
└─────────────────────────────────────────────────────────┘
                          │
                          ↓ consumed by
┌─ Signal engine + LLM synthesis ────────────────────────┐
│  13 deterministic rules (signal-engine.ts)             │
│  + Haiku 4.5 classification + Sonnet 4.6 digest        │
└─────────────────────────────────────────────────────────┘
                          │
                          ↓ produces
┌─ Tasks + Digest + Drawer ──────────────────────────────┐
│  Severity-tiered routing → AE/RevOps action queue       │
└─────────────────────────────────────────────────────────┘
```

---

## What's outside the 14: the live-world signal layer

The 14 internal systems above tell us what the workspace's *own systems* observe. The other half of Dugout — already built — is what the *outside world* says about the workspace's accounts. Today this layer has three adapters:

| Source | Status | Adapter | Tier |
|---|---|---|---|
| **NewsAPI** | Live (production) | `src/lib/news-adapter.ts` | AWARENESS/ACTION (Haiku-classified) |
| **SEC EDGAR** | Live (production) | `src/lib/sec-adapter.ts` | AWARENESS/ACTION (filing-type rules) |
| **Inbound email** | Live (production) | `src/lib/newsletter-adapter.ts` — Mailgun + SendGrid | AWARENESS/ACTION (Haiku-classified) |

The inbound email pipeline is the **universal extension slot** for the live-world layer. Anything that emits email — Substack subscriptions, X email digests, Google Alerts, newsletter aggregators, internal forwards from reps — routes through one adapter. New sources require zero new code; they require a new forwarding rule.

### Open slots for future live-world sources

| Source | Why it'd matter for the wedge | Integration path |
|---|---|---|
| LinkedIn job changes | Faster than ZoomInfo for some segments | Licensed provider (PhantomBuster/Apollo) or inbound email digest |
| Crunchbase funding/M&A | Funding event = budget unlocks for procurement | Public API; ~150 LOC adapter |
| Glassdoor sentiment | Layoff signals before press release | Web scrape (TOS risk) or licensed provider |
| Built With / technographics | Stack changes at account = re-eval moment | BuiltWith API |
| Public company earnings transcripts | Mentions of category investment + budget priorities in the customer's vertical | Inbound email (subscribe to AlphaSense/Seeking Alpha) |
| Reddit / Hacker News | Engineering-led buying signals for the customer's category | Subscription via Google Alerts → email pipeline |
| Substack newsletters by buyer-persona authors | What the buying committee is actually reading | Subscribe each to inbound email — no new adapter |

The inbound-email pipeline absorbs at least the bottom four with zero engineering work.

---

## What's NOT in this dictionary (deliberately)

- **Workspace config** — handled in `src/lib/workspace.ts` cookie today; will move to `orgs/_default/workspace.md` when the Obsidian-style context layer ships.
- **Playbooks** — `src/data/playbooks.ts` today; will move to `orgs/_default/playbooks/*.md` in the same migration.
- **Account-specific notes** — these are *per-account* per-org context, distinct from *per-tool* signal definitions. They live in `orgs/<slug>/accounts/<account>.md` if/when that view ships.

The signal dictionary is **the contract with the data sources**. Workspace config is **the contract with the customer's GTM motion**. Playbooks are **the contract with the rep's playbook responses**. Three different artifacts, three different lifecycles.

---

## Onboarding pattern (the GTM Engineer story)

Adding a new customer org to Dugout = adding a new `orgs/<slug>/` folder with:

```
orgs/<slug>/
├── dictionary.md           # this file, customized per their stack
├── tools/<tool>.md         # one per tool in their actual stack
├── workspace.md            # their wedge, stages, ICP, MEDDPICC fields
├── playbooks/*.md          # their plays
└── accounts/*.md           # optional per-account notes
```

The 14 tool dictionaries here are templates — for a different customer, swap Salesforce → HubSpot CRM, swap Outreach → Salesloft, etc. The *structure* of the dictionary is universal; the *content* is per-customer. **This is the GTM Engineering answer to "how do you onboard a new customer?"**

---

## Maintenance

- Each `tools/<slug>.md` is owned by whoever last touched the live integration (or whoever proposed it).
- "Open questions" sections are the live debt list — when a question resolves, update the doc.
- Cross-tool patterns above should be revisited whenever a new tool is added or signal counts shift materially.
- This index is the authoritative count of signals. If the count doesn't match `src/lib/signal-engine.ts`, one of them is wrong.

---

## Next concrete steps (in priority order)

1. **Build `/stack` page in Dugout.** Renders this dictionary as a visual flow: 14 tool logos → Dugout → sales team. Each tool clickable → opens its `tools/<slug>.md` rendered. Half a day of work, lands the demo visual.
2. **Wire the existing `signal-engine.ts` rule names to the signals in this dictionary.** Right now the dictionary references rule shapes that don't yet exist in code. Even a stub `// TODO: rule for dock_buying_committee_gap` in `signal-engine.ts` for each BLOCKING signal makes the dictionary executable-by-aspiration.
3. **Pick one Tier-S tool and write the adapter for real.** Dock if access is possible, otherwise ZoomInfo (public docs are clean). Demonstrates the pattern works end-to-end.
4. **Schedule a 15-min call with the stakeholder mentor** to answer the highest-leverage open questions from this dictionary (Dock SF package event granularity, Swyft custom field names, ZoomInfo SKU bundle, Gong tracker config ownership).
5. **Extend the inbound-email pipeline** to subscribe to 3-5 newsletters focused on the customer's vertical as a "live-world layer" demonstration. Zero engineering work; pure GTM curation.
