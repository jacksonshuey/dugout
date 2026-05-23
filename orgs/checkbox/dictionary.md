# Checkbox — Signal Dictionary (Index)

> The structured catalog of what Dugout knows about Checkbox's world. Per-tool details live in `tools/*.md`.
> - **The unified relational model + tiered storage + AI query layer:** [synthesis.md](synthesis.md)
> - **AE + Manager workflow research + UX prioritization:** [discovery/](discovery/) — start with [information-requirements.md](discovery/information-requirements.md)

## What this is

A "dictionary" in Dugout's sense is **not** a glossary of terms. It is the structured contract between Checkbox's operating systems (the 12 tools below + the live-world feeds Dugout already ingests) and Dugout's signal engine. Each entry answers:

- *What data does this source emit?*
- *Which 2–4 signals from it actually move the needle on the wedge?*
- *What rule consumes the signal? At what severity tier?*
- *What's the realistic cost to wire it?*
- *What would we ignore — and why?*

The dictionary is read by humans (sales ops authoring playbooks, AEs understanding why a task fired) and by the engine (rules, the morning digest LLM, the orchestration layer).

---

## The wedge, restated

Checkbox deals die at **Selected Vendor** — the gap between verbal champion buy-in and procurement/finance/IT/legal approval. Every signal in this dictionary is graded on a single question: *does it shorten the time between "deal stall begins" and "AE knows about it"?*

Severity tiers:

| Tier | Routing | Latency target |
|---|---|---|
| **BLOCKING** | Slack DM to AE owner | < 1 hour |
| **ACTION** | Today's task list in the console | < 24 hours |
| **AWARENESS** | Weekly digest entry | < 7 days |

---

## The 12 internal operating systems

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

**Totals:** 42 signals across 12 tools. 12 BLOCKING-tier, ~20 ACTION-tier, ~10 AWARENESS-tier. Estimated full-wire effort: ~3,500 LOC, ~3-4 weeks single-engineer.

### Tier S (wedge anchors — wire first)

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

### Tier C (low standalone, defensible as adapter stubs)

- **Nooks** — SDR-stage; account-level org-change detection only.
- **Webflow** — CMS without identity; useful only if de-anon layer is added.

---

## Cross-tool patterns: the ontology emerging

The point of the dictionary is not the 12 individual cards — it's the **relationships between them**. Several signals correlate across tools, and *correlated signals are higher-confidence than any single source*. This is where the ontology earns its keep.

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

---

## The architectural picture

```
┌─ Internal operating systems (the 12 tools above) ──────┐
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

## What's outside the 12: the live-world signal layer

The 12 internal systems above tell us what Checkbox's *own systems* observe. The other half of Dugout — already built — is what the *outside world* says about Checkbox's accounts. Today this layer has three adapters:

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
| Public company earnings transcripts | Mentions of legal-ops investment, GRC priorities | Inbound email (subscribe to AlphaSense/Seeking Alpha) |
| Reddit / Hacker News | Engineering-led buying signals for legal-tech adoption | Subscription via Google Alerts → email pipeline |
| Substack newsletters by buyer-persona authors | What the buying committee is actually reading | Subscribe each to inbound email — no new adapter |

The inbound-email pipeline absorbs at least the bottom four with zero engineering work.

---

## What's NOT in this dictionary (deliberately)

- **Workspace config** — handled in `src/lib/workspace.ts` cookie today; will move to `orgs/checkbox/workspace.md` when the Obsidian-style context layer ships.
- **Playbooks** — `src/data/playbooks.ts` today; will move to `orgs/checkbox/playbooks/*.md` in the same migration.
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

The 12 tool dictionaries here are templates — for a different customer, swap Salesforce → HubSpot CRM, swap Outreach → Salesloft, etc. The *structure* of the dictionary is universal; the *content* is per-customer. **This is the GTM Engineering answer to "how do you onboard a new customer?"**

---

## Maintenance

- Each `tools/<slug>.md` is owned by whoever last touched the live integration (or whoever proposed it).
- "Open questions" sections are the live debt list — when a question resolves, update the doc.
- Cross-tool patterns above should be revisited whenever a new tool is added or signal counts shift materially.
- This index is the authoritative count of signals. If the count doesn't match `src/lib/signal-engine.ts`, one of them is wrong.

---

## Next concrete steps (in priority order)

1. **Build `/stack` page in Dugout.** Renders this dictionary as a visual flow: 12 tool logos → Dugout → sales team. Each tool clickable → opens its `tools/<slug>.md` rendered. Half a day of work, lands the demo visual.
2. **Wire the existing `signal-engine.ts` rule names to the signals in this dictionary.** Right now the dictionary references rule shapes that don't yet exist in code. Even a stub `// TODO: rule for dock_buying_committee_gap` in `signal-engine.ts` for each BLOCKING signal makes the dictionary executable-by-aspiration.
3. **Pick one Tier-S tool and write the adapter for real.** Dock if access is possible, otherwise ZoomInfo (public docs are clean). Demonstrates the pattern works end-to-end.
4. **Schedule a 15-min call with Jacob Katz** to answer the highest-leverage open questions from this dictionary (Dock SF package event granularity, Swyft custom field names, ZoomInfo SKU bundle, Gong tracker config ownership).
5. **Extend the inbound-email pipeline** to subscribe to 3-5 legal-ops-focused newsletters as a "live-world layer" demonstration. Zero engineering work; pure GTM curation.
