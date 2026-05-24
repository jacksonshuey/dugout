# Dugout Newsletter Master Plan

> Synthesis of the 9-vertical research swarm (2026-05-23). **~330 verified newsletters** across legal-tech, enterprise tech, PE, insurance, healthcare, fintech, pharma, AI cross-cutting, GTM/exec-moves. Per-vertical detail lives in sibling files. This file is the orchestration layer: what to subscribe, in what order, with what infra prerequisites.

**Last updated:** 2026-05-23. Sources: 9 background research agents, each verified via WebSearch + (where allowed) WebFetch.

---

## 1. Executive summary

| Metric | Value |
|---|---|
| Total verified newsletters | ~331 across 9 vertical files |
| Free / freemium | ~250 (75%) |
| Paid (≤$50/mo) | ~50 |
| Enterprise-paid (≥$500/yr) | ~30 |
| Demo-priority vertical | **legal-tech** (60+ entries, deepest coverage) |
| Architectural prerequisites before mass subscribe | **5** (see §2) |
| Phase 1 subscription target | 10 newsletters |
| Phase 2 target | 50 newsletters (top 5 per vertical) |
| Phase 3 target | full ~330 |

**Per-vertical inventory:**

| Vertical | File | Entries | Demo account |
|---|---|---|---|
| Legal-tech | [legal-tech.md](legal-tech.md) | 60+ | (none — buyer persona) |
| Enterprise tech | [enterprise-tech.md](enterprise-tech.md) | 36 | acc_atlas (Snowflake) |
| Private equity | [private-equity.md](private-equity.md) | 34 | acc_meridian (KKR) |
| Insurance | [insurance.md](insurance.md) | 34 | acc_sentinel (CNA Financial) |
| Healthcare | [healthcare.md](healthcare.md) | 35 | acc_helios (UnitedHealth) |
| Fintech | [fintech.md](fintech.md) | 36 | acc_stripe (Stripe) |
| Pharma | [pharma.md](pharma.md) | 33 | acc_apex (Pharma) |
| AI cross-cutting | [ai-cross-cutting.md](ai-cross-cutting.md) | 35 | (cross-vertical) |
| GTM / exec-moves | [gtm-exec-moves.md](gtm-exec-moves.md) | 28 | (champion-departure signal source) |

---

## 2. Architectural prerequisites — ship BEFORE >10 newsletters

Five findings emerged consistently across 5+ research agents. These are inbound-pipeline upgrades that need to land BEFORE we subscribe to 50+ newsletters, or the AgentMail classifier will silently misroute or drop signals.

### 2.1 List-ID classifier (P1 — blocks mass subscribe)

**Finding:** Substack, Industry Dive, Wells Media, PEI Group, Questex/Fierce, and Campaign Monitor all collapse multiple publications onto one shared sending domain. Without List-ID routing, every Substack publication looks like one source.

**Affected sender clusters:**
- `industrydivenews.com` — 8+ publications (Healthcare Dive, Banking Dive, Payments Dive, CFO Dive, CIO Dive, HR Dive, BioPharma Dive, PharmaVoice, Legal Dive when alive)
- `wellsmedia.omeda.com` — Insurance Journal + Carrier Management + Claims Journal
- `e.questex.com` / `email.fierce*.com` — Fierce Healthcare + Fierce Pharma + Fierce Biotech + Fierce Healthcare Payer
- `pei.group` — 8+ paid PE trade pubs
- `*.substack.com` — 60+ publications across all verticals
- `cmail1-20.com` / `createsend7.com` (Campaign Monitor ESP) — Endpoints uses both
- `*.beehiiv.com` — Brainyacts, Hospitalogy, Second Opinion, Health Tech Nerds, Healthcare AI Guy, Stablecoin Insider

**Fix:** Modify `src/lib/inbound-pipeline.ts` to extract `List-ID` from email headers and use it as the publication identifier (RFC-2919 standard, stable across senders). Fall back to `From:` only when `List-ID` absent.

**Effort:** ~30 min + tests. Small change, blocks ~30% of useful coverage if unfixed.

### 2.2 Publisher canonical name field (P2)

**Finding:** Even after List-ID routing, the same publication can route through different ESPs at different times (Endpoints uses `endpts.com` AND `endpointsnews.com` AND Campaign Monitor relays). The classifier needs a `publisher_canonical_name` field decoupled from raw sender domain.

**Fix:** Add `publisher` column to `inbound_emails` table; populate via a lookup table maintained in `src/lib/inbound-publishers.ts` keyed on `(list_id, sender_domain)`. Migration + small lib file.

**Effort:** ~1 hour. Pairs naturally with 2.1.

### 2.3 Gmail 102KB clip threshold (P2)

**Finding:** Latent Space, Interconnects, Ahead of AI, Don't Worry About the Vase, and other long-form newsletters routinely exceed Gmail's 102KB clip threshold. The AgentMail webhook will receive the truncated body + a "View entire message" link. Today the classifier will work on half the signal.

**Fix:** In `src/lib/newsletter-adapter.ts`, detect the clip marker, follow the link, fetch the full HTML, run classifier on the merged body. Small but real.

**Effort:** ~45 min + a fixture test against a real clipped email.

### 2.4 Vendor-blog signal weighting (P3)

**Finding:** AI-in-PE coverage is dominated by vendor blogs (Hebbia, Affinity, AlphaSense, Sourcescrub, Carta). Same pattern in legal-tech (Harvey, Spellbook, Ironclad, LinkSquares). Same in insurance (Roots Automation, Sønr). These are marketing content, not journalism — different signal weighting needed.

**Fix:** Add `is_vendor` boolean to `external_signals`. Vendor signals get severity ceiling of `awareness` regardless of content. Avoids gaming by competitor product announcements.

**Effort:** ~20 min schema + classifier prompt tweak.

### 2.5 RSS adapter scaffold (P2)

**Finding:** Several high-signal sources don't publish email newsletters:
- **NAIC newsroom** (insurance regulatory) — recommended by insurance agent over a non-existent state-DOI newsletter
- **Lil'Log** (Lilian Weng / Thinking Machines on agents + reasoning) — RSS only
- **In the Pipeline** (Derek Lowe / Science blog) — RSS-friendly
- **HIStalk** (healthcare IT) — likely Feedburner

**Fix:** A small `src/lib/rss-adapter.ts` paired with a daily cron, writing into `external_signals` with `source='rss'`. Symmetric with NewsAPI / SEC adapters.

**Effort:** ~2 hours (new adapter, but well-trodden pattern in this codebase).

---

## 3. Phased subscription rollout

### Phase 0 — Smoke test (today, ~30 min)

**One newsletter, one webhook event end-to-end.** Subscribe **Artificial Lawyer** (free, daily, legal-tech demo-priority). Confirm:
1. AgentMail receives the inbound event with valid Svix signature.
2. Row lands in `inbound_emails` with parsed body.
3. `classify-pending` cron drains the queue.
4. Haiku 4.5 classifier emits 1+ signals into `external_signals` with `source='newsletter'`.
5. Row appears on `/market-intel`.
6. Ranker (now shipped — see §6) re-orders it appropriately.

**Why this comes first:** the AgentMail pipeline has never been tested with a real event (HANDOFF.md §11). If anything in the pipe is broken, we want to find out with one newsletter, not 50.

### Phase 1 — Top 10 cross-vertical (week 1, after Phase 0 + List-ID fix)

The 10 highest signal-per-effort across all verticals. All free.

| # | Newsletter | Vertical | Cadence | Sender domain |
|---|---|---|---|---|
| 1 | **Artificial Lawyer** | Legal-tech (demo) | Daily | `artificiallawyer.com` |
| 2 | **Boardroom Alpha — D&O Moves** | Exec-moves (champion-departure signal) | Weekly + alerts | `boardroomalpha.com` |
| 3 | **CFO Dive** | Exec-moves (Checkbox's #1 champion persona) | Daily | `industrydivenews.com` |
| 4 | **Brainyacts (Josh Kubicki)** | Legal-tech AI | 4-5x/week | `thebrainyacts.beehiiv.com` |
| 5 | **Import AI (Jack Clark)** | AI cross-cutting | Weekly | `importai.substack.com` |
| 6 | **Money Stuff (Matt Levine)** | Finance/regulatory (PE + fintech) | Daily | `bloomberg.net` |
| 7 | **Axios Pro Rata** | Deal flow (cross-vertical) | Daily | `link.axios.com` |
| 8 | **Endpoints News** | Pharma (Apex demo account) | Daily | `endpts.com` |
| 9 | **STAT Morning Rounds** | Healthcare (UnitedHealth demo) | Daily | `statnews.com` |
| 10 | **LawSites (Bob Ambrogi)** | Legal-tech (buyer-side voice) | 3-5x/week | `lawnext.com` |

**Cost:** $0. After 1 week of inbound, audit classifier hit rate. Tune prompts if false-positive rate >20%.

### Phase 2 — Per-vertical top 5 (week 2, after publisher-canonical-name fix)

Subscribe top 5 from each of the 9 vertical files. ~45 newsletters total (some overlap with Phase 1 — net add ~35).

See per-vertical detail files for the picks. Bundles to flag:
- **Industry Dive bundle** — one allowlist entry (`industrydivenews.com`) unlocks Healthcare Dive + Banking Dive + Payments Dive + CFO Dive + CIO Dive + HR Dive + BioPharma Dive + PharmaVoice. **8 publications for 1 sender-domain entry.**
- **Wells Media bundle** — `wellsmedia.omeda.com` covers Insurance Journal + Carrier Management + Claims Journal.
- **Substack wildcard** — `substack.com` covers ~60 entries; List-ID routing required to disambiguate.

### Phase 3 — Deep coverage (week 3+)

Subscribe the remaining ~280. Phase here is optional — Phase 2 covers ~80% of useful signal.

### Phase 4 — Paid tier (revenue-gated)

Reserve for when Checkbox starts paying Dugout for the seat. Top picks if budget unlocks:
- **WSJ Pro Private Equity** (~$2-3k/yr) — best per-dollar PE signal
- **PEI Group bundle** (1 seat unlocks 8 trade pubs — but enterprise pricing)
- **STAT+** (~$399/yr) — payor/PBM scoops
- **The Information** (~$399-749/yr) — enterprise-AI + tech scoops
- **Pink Sheet + Scrip** (Citeline, enterprise) — pharma regulatory gold standard
- **Stratechery Daily** (~$144/yr) — business-strategy AI lens

---

## 4. Sender-domain allowlist

Drop into `INBOUND_SENDER_ALLOWLIST` env var (comma-separated) once List-ID classifier ships. Each domain may carry multiple publications (see comments).

```
# Industry Dive bundle — 8+ publications
industrydivenews.com

# Wells Media bundle — Insurance Journal + Carrier Management + Claims Journal
wellsmedia.omeda.com

# Questex / Fierce bundle — Fierce Healthcare + Fierce Pharma + Fierce Biotech + Fierce Healthcare Payer
e.questex.com

# Substack wildcard — 60+ publications, List-ID routing required
substack.com

# Beehiiv — Brainyacts, Hospitalogy, Second Opinion, Health Tech Nerds, Stablecoin Insider
beehiiv.com

# Campaign Monitor relays (Endpoints + others)
cmail1.com,cmail2.com,cmail3.com,cmail4.com,cmail5.com,cmail6.com,cmail7.com,cmail8.com,cmail9.com,cmail10.com,createsend7.com

# Individual high-signal domains (verified)
artificiallawyer.com
lawnext.com
legaltechnology.com
news.bloomberglaw.com
bloombergindustry.com
abovethelaw.com
iapp.org
acc.com
runtime.news
stratechery.com
theinformation.com
endpts.com
endpointsnews.com
statnews.com
list-manage.com
agencyiq.com
axios.com
link.axios.com
fortune.com
email.fortune.com
bloomberg.net
nytimes.com
ft.com
boardroomalpha.com
politico.com
email.politico.com
washingtonpost.com
modernhealthcare.com
beckershospitalreview.com
healthcareittoday.com
histalk2.com
drugchannels.net
hpm.com
raps.org
medcitynews.com
coverager.com
reinsurancene.ws
artemis.bm
ambest.com
spglobal.com
businessinsurance.com
intelligentinsurer.com
insuranceerm.com
ftpartners.com
americanbanker.com
finextra.com
pymnts.com
cbinsights.com
coindesk.com
blockworks.com
fintechbrainfood.com
bitsaboutmoney.com
netinterest.co
pitchbook.com
crunchbase.com
puck.news
deeplearning.ai
smol.ai
latent.space
interconnects.ai
oneusefulthing.org
exponentialview.co
magazine.sebastianraschka.com
eugeneyan.com
huggingface.co
techpolicy.press
cset.georgetown.edu
hai.stanford.edu
safe.ai
artificialintelligenceact.substack.com
platformer.news
a16z.com
mckinsey.com
bcg.com
bain.com
sequoiacap.com
joinpavilion.com
30mpc.com
demandcurve.com
thedailyupside.com
morningbrew.com
reuters.com
chiefexecutive.net
deloitte.com
```

~85 domains. The first 6 (`industrydivenews.com` + Wells Media + Questex + Substack + Beehiiv + Campaign Monitor) collectively cover ~100 of the ~330 newsletters. Marginal ROI on individual domains tapers fast after #50.

---

## 5. Cross-agent conflicts — resolved

**Legal Dive status: DEAD.** GTM/exec-moves agent reports shutdown Feb 22, 2025 (with citation: Informa TechTarget shut it down). Legal-tech agent listed it as a top-10 pick without verifying the signup page returned. GTM agent has the specific evidence; legal-tech agent is wrong. **Action:** drop Legal Dive from [legal-tech.md](legal-tech.md) §2.2; replace with **Deloitte's Take Note** (CLO-focused, monthly, free) per GTM agent's recommendation. The free CLO/GC-moves market is now thin — see §7 for the editorial opportunity.

---

## 6. Ranker — SHIPPED

The market-intel ranker (separate workstream from this consolidation) shipped via the D-Rank → I-Rank → A-Rank pipeline. **Status: APPROVE WITH FIXES (per A-Rank), one P2 fix applied inline, ready to merge.**

- **8 new files** in `src/lib/ranker*.ts`, `src/components/ranker-banner.tsx`, `supabase/migrations/20260524_ranker_cache.sql`
- **2 modified files** (`src/app/market-intel/page.tsx` + `src/lib/workspace.ts`)
- **131/131 tests passing** (113 baseline + 18 new ranker cases)
- **Migration must be run manually** in Supabase Studio before the cache works
- Falls back to deterministic stub with amber banner when `ANTHROPIC_API_KEY` missing or Haiku 5xx
- Account-named items outrank severity in BOTH Haiku and stub modes ("no cold meetings" principle)

Once Phase 1 newsletters are subscribed, the ranker will start providing real value immediately — re-ordering chronological intel by account-relevance then severity, with a one-sentence Haiku-generated rationale per item.

---

## 7. Open follow-ups + editorial opportunities

### Coverage gaps worth a second pass
- **Sovereign-wealth-fund flow** (GIC, ADIA, Mubadala, PIF) — no strong free newsletter exists. PE agent flagged this as a Dugout-internal tracker opportunity.
- **US state DOI bulletins** — too granular for individual newsletters. Per insurance agent: poll NAIC newsroom RSS directly (see §2.5).
- **Chief Data Officer trade press** — no strong newsletter exists. Enterprise-tech agent flagged this as a content gap an AE-targeted product could fill.

### Editorial / GTM opportunities
- **Free CLO/GC-moves vacuum** — Legal Dive's shutdown means there's no free daily covering in-house legal C-suite moves. **Dugout could fill this editorially** as a top-of-funnel acquisition channel: "the morning brief for in-house legal." Same architecture, served from `external_signals` filtered to `signal_type='leadership_change'` + `vertical='legal'`. Worth raising in the Checkbox interview as a Q1 product roadmap idea.

### Subscription mechanics caveats
- Sender domains marked "best guess" in vertical files need verification on first inbound. Insurance + GTM agents both recommended `inbox+<vertical>@dugout-agentmail` per-vertical addresses to capture exact From: headers before writing deterministic allowlist rules.
- **Forwarding-blocked sources:** The Information ($399+/yr) and Stratechery use account-bound paid emails that may break on forwarding. Test before relying.
- **MIT Sloan Management Review winding down** — don't build long-term dependency.
- **PEI Group monopoly** — one paid seat unlocks 8 trade pubs via shared `pei.group` infra. Highest paid-tier ROI if Dugout ever needs PE depth.

---

## 8. What to do today

Concrete next-action list, ordered:

1. **Run the smoke test** (Phase 0). Subscribe Artificial Lawyer at the AgentMail webhook address. Confirm end-to-end.
2. **Apply the ranker migration** in Supabase Studio: paste `supabase/migrations/20260524_ranker_cache.sql`, run.
3. **Decide on the 5 architectural prerequisites** (§2). Recommend shipping at least §2.1 (List-ID classifier) before Phase 2 — without it, ~30% of useful coverage routes to one bucket.
4. **Merge the ranker branch** to main once you're confident in the manual smoke test. Branch is `claude/agentmail-rotation` (HEAD ahead of main per HANDOFF.md §6).
5. **Schedule the Phase 1 subscription session** (10 newsletters, ~30 min of clicking signup links).

Per-vertical detail and full sender-domain context lives in the 9 sibling files in this directory.
