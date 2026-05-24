# Pharma / Biotech / Life Sciences Newsletters

Curated source list for Dugout's AgentMail ingestion pipeline. Vertical scope: pharma, biotech, CROs, medical devices. Buyer persona being informed: AEs at Checkbox selling legal-tech into in-house legal teams at pharma companies.

Selection criteria: real, currently active in 2026, plain HTML email body where possible, forwarding-friendly, freemium-leaning. Paid tiers flagged. Sender domains are best-guess based on publisher infrastructure (verify on first inbound webhook and update `external_signals.sender_domain_map` accordingly).

---

## 1. Top 5 Picks (subscribe first)

1. **Endpoints News (free daily)** — The de-facto morning paper for biopharma deals, FDA actions, and pipeline news. If an AE reads one thing before a Pfizer call, it's this. Daily AM. Free (paid Premium tier exists). Sender: `endpts.com` (also `endpointsnews.com`, ESP via `cmail*.com`).
2. **STAT Pharmalittle (free morning brief from Ed Silverman)** — Tight 5-day-a-week roundup of overnight pharma news with editorial voice; perfect signal-to-noise ratio. Free (companion to paid STAT+). Sender: `statnews.com`.
3. **BioPharma Dive (free, Industry Dive)** — Clean daily roundup of clinical readouts, FDA approvals, M&A, drug pricing. Industry Dive format = highly forwardable plain HTML. Daily. Free. Sender: `biopharmadive.com` / `industrydive.com`.
4. **FiercePharma Daily (free)** — Big-pharma commercial news: launches, marketing, layoffs, lawsuits. The "what is Pfizer/Merck/Lilly actually doing" feed. Daily. Free. Sender: `fiercepharma.com` (Questex / `e.questex.com`).
5. **AgencyIQ FDA Today (free, POLITICO)** — Expert FDA/EMA regulatory analysis written for RA professionals, not generalists. Critical when AEs are pitching CLM / contract review to regulatory affairs orgs. Tue–Fri. Free. Sender: `agencyiq.com` / `politico.com`.

---

## 2. Full Newsletter Table

| Name | Publisher | Cadence | Cost | Sender domain (best guess) | Signal density (1-5) | Why an AE selling to pharma cares | Subscribe URL |
|---|---|---|---|---|---|---|---|
| Endpoints News (Daily) | Endpoints News | Daily AM | Free | `endpts.com` / `endpointsnews.com` | 5 | The single best morning pulse on biopharma deals, FDA actions, pipeline reads — table stakes for any pharma-facing rep. | https://endpoints.news/ |
| Endpoints FDA+ | Endpoints News | Weekly (Wed 2pm ET) | Free | `endpts.com` | 5 | Dedicated FDA channel — track regulatory shifts that drive in-house legal demand. | https://endpts.com/channel/fda-plus/ |
| Endpoints Manufacturing | Endpoints News | Weekly (Thu 2pm ET) | Free | `endpts.com` | 4 | CMC, plant inspections, supply chain — context for med-device + CDMO buyers. | https://endpts.com/channel/manufacturing/ |
| STAT Pharmalittle | STAT News | M–F AM | Free | `statnews.com` | 5 | Ed Silverman's morning brief — concise, opinionated, exactly the digest a busy AE needs. | https://www.statnews.com/signup/ |
| STAT Pharmalot | STAT News | M–F PM | Free (some links STAT+) | `statnews.com` | 5 | Afternoon companion — covers pricing, IRA, PBMs, litigation. | https://www.statnews.com/category/curated/pharmalot-newsletter/ |
| STAT+ (Pharma & Biotech) | STAT News | Daily + on-publish | Paid ($39/mo, $399/yr) | `statnews.com` | 5 | Premium scoops on M&A, FDA, biotech IPOs — flag PAID. | https://www.statnews.com/stat-plus/ |
| BioPharma Dive | Industry Dive / Informa TechTarget | Daily | Free | `biopharmadive.com` / `industrydive.com` | 5 | Clean, fast roundup of clinical, regulatory, M&A — forwarding-friendly HTML. | https://www.biopharmadive.com/signup/ |
| PharmaVoice | Industry Dive | Daily | Free | `pharmavoice.com` / `industrydive.com` | 4 | Commercial-side pharma — marketing, leadership moves, agency news. Useful for sales context. | https://www.pharmavoice.com/signup/ |
| FiercePharma | Questex | Daily | Free | `fiercepharma.com` / `e.questex.com` | 4 | Big-pharma commercial + corporate news; layoffs and reorgs are major buying signals for legal-tech. | https://www.fiercepharma.com/fiercepharmacom/fp-newsletters |
| FierceBiotech | Questex | Daily | Free | `fiercebiotech.com` / `e.questex.com` | 4 | Clinical-stage biotech news — pipeline reads, funding, IPOs. | https://www.fiercebiotech.com/fiercebiotechcom/fb-newsletters |
| Fierce Pharma Manufacturing | Questex | Weekly | Free | `fiercepharma.com` | 3 | Plant warning letters and recalls — quality/regulatory triggers. | https://www.fiercepharma.com/fiercepharmacom/fp-newsletters |
| Fierce Biotech Research | Questex | Weekly | Free | `fiercebiotech.com` | 3 | Preclinical + discovery science — early-pipeline lens for biotech accounts. | https://www.fiercebiotech.com/fiercebiotechcom/fb-newsletters |
| Fierce Life Sciences Weekly Digest | Questex | Weekly | Free | `fiercelifesciences.com` | 3 | Cross-pub digest — efficient catchall if individual Fierce titles are too noisy. | https://www.fiercelifesciences.com/fiercelifesciencescom/join-mailing-list |
| AgencyIQ FDA Today: Life Sciences | POLITICO | Tue–Fri | Free | `agencyiq.com` / `politico.com` | 5 | Best-in-class FDA regulatory analysis written by ex-RA pros — speak the language of in-house regulatory counsel. | https://www.agencyiq.com/subscribe-fda-today/ |
| AgencyIQ EMA Today | POLITICO | Tue & Thu | Free | `agencyiq.com` / `politico.com` | 4 | EU regulatory parallel — essential for any pharma client with EMA exposure. | https://www.agencyiq.com/subscribe-ema-today/ |
| Pink Sheet (Citeline) | Citeline / Norstella | Daily | Paid (enterprise) | `citeline.com` / `informa.com` | 5 | Gold-standard regulatory/policy intel — flag PAID, enterprise pricing only. | https://insights.citeline.com/pink-sheet/ |
| Scrip (Citeline) | Citeline / Norstella | Daily | Paid (enterprise) | `citeline.com` / `informa.com` | 5 | Commercial intel — licensing deals, partnerships, market access. Flag PAID. | https://insights.citeline.com/scrip/ |
| BioCentury | BioCentury Inc. | Weekly + daily Extra | Paid (enterprise) | `biocentury.com` | 5 | Investor-grade biotech analysis — used by BD orgs. Flag PAID. | https://www.biocentury.com/contact/subscribe |
| Evaluate Vantage | Evaluate Ltd. | Daily | Free (data is paid) | `evaluate.com` | 4 | Data-driven biotech/medtech news — pipeline forecasts and deal value coverage. | https://www.evaluate.com/vantage |
| In the Pipeline (Derek Lowe) | Science / AAAS | 4–5x/week | Free | `science.org` / `aaas.org` | 4 | Industry-favorite medicinal-chemistry blog — gives AEs credible color on drug-discovery realities. | https://www.science.org/blogs/pipeline |
| Timmerman Report | Timmerman Report LLC | 2–3x/week | Paid (~$30/mo) | `timmermanreport.com` | 4 | Luke Timmerman's reader-supported deep dives — top tier among biotech insiders. Flag PAID. | https://timmermanreport.com/ |
| Axios Pro: Biotech Deals | Axios | M–F | Paid (Pro tier) | `axios.com` | 5 | Real-time pharma/biotech BD intel — directly maps to M&A trigger events for legal-tech ICP. Flag PAID. | https://www.axios.com/pro/biotech-deals |
| Axios Pro: Health Tech Deals | Axios | M–F | Paid (Pro tier) | `axios.com` | 4 | Adjacent digital-health and big-pharma tech-deal coverage. Flag PAID. | https://www.axios.com/pro/health-tech-deals |
| Axios Vitals | Axios | Daily AM | Free | `axios.com` | 3 | Free version — broader healthcare news, IRA + drug-pricing color. | https://www.axios.com/newsletters |
| BioPharma-Reporter | William Reed | Daily/Weekly | Free | `biopharma-reporter.com` / `william-reed.com` | 3 | EU-leaning manufacturing + CDMO coverage — useful for non-US pharma accounts. | https://www.biopharma-reporter.com/ |
| Drug Discovery & Development | WTWH Media | Weekly | Free | `drugdiscoverytrends.com` / `wtwhmedia.com` | 3 | R&D-side news — pipeline + AI-in-discovery angle. | https://www.drugdiscoverytrends.com/sign-up-for-the-drug-discovery-development-enewsletter/ |
| Pharmaceutical Technology | GlobalData | Weekly | Free | `pharmaceutical-technology.com` / `globaldata.com` | 3 | Drug development + manufacturing trends; GlobalData-backed analysis. | https://www.pharmaceutical-technology.com/newsletters/ |
| Drug Channels | Drug Channels Institute (HMP Global) | ~Weekly | Free (reports paid) | `drugchannels.net` / `feedburner.com` | 5 | Adam Fein's authoritative analysis of 340B, PBMs, IRA, drug pricing — pure ICP fuel. | https://www.drugchannels.net/ |
| FDA Law Alert (HPM) | Hyman, Phelps & McNamara | Quarterly + blog | Free | `hpm.com` / `thefdalawblog.com` | 4 | Largest FDA-dedicated law firm — content style mirrors what in-house regulatory lawyers read. Direct ICP overlap. | https://hpm.com/publications/fda-law-alert/ |
| RAPS Regulatory Focus (RF Today) | Regulatory Affairs Professionals Society | M–F | Free (membership tiers) | `raps.org` | 4 | Daily regulatory intel from the largest RA professional body. | https://www.raps.org/news-and-articles |
| MedCity News | MedCity News / Breaking Media | Daily | Free | `medcitynews.com` | 3 | Healthtech + biopharma intersection; lighter density but good for innovator/startup pharma accounts. | https://medcitynews.com/subscribe/ |
| Locust Walk Insights | Locust Walk (boutique IB) | Quarterly + ad-hoc | Free | `locustwalk.com` | 3 | Boutique-bank perspective on biopharma BD/licensing trends — useful for M&A signal context. | https://www.locustwalk.com/insights/ |
| GoodRx Health (prescription savings) | GoodRx | Weekly | Free | `goodrx.com` | 2 | Consumer-facing but surfaces real-time pricing signals (IRA negotiation, copay programs). Lower priority. | https://www.goodrx.com/newsletters |

---

## 3. AI-in-Pharma Subsection

Specialized feeds covering AI in drug discovery, clinical trials, real-world evidence, and manufacturing. All free unless noted.

| Name | Publisher / Author | Cadence | Cost | Sender domain | Signal density | Why it matters | Subscribe URL |
|---|---|---|---|---|---|---|---|
| Decoding Bio (BioByte) | Decoding Bio / Arkaea Media | Weekly | Free + paid tier | `substack.com` (custom: `decodingbio.com`) | 5 | The flagship AI-x-bio weekly — 11k+ subs incl. pharma execs and VCs. Tracks foundation models, lab automation, AI-native biotechs. | https://www.decodingbio.com/newsletter |
| Where Tech Meets Bio (BiopharmaTrend) | Andrii Buvailo / BiopharmaTrend | Weekly (free) + deep dives (paid) | Freemium | `substack.com` / `techlifesci.com` | 4 | Tracks AI-in-pharma deals (Lilly+NVIDIA, Pfizer+OpenAI etc.) — ICP-aligned. | https://www.techlifesci.com/ |
| Owl Posting | Abhishaike Mahajan | ~Weekly | Free | `substack.com` (custom: `owlposting.com`) | 4 | Technical ML-in-biology essays by a working ML-bio engineer (Noetik, ex-Dyno) — credibility builder for technical pharma calls. | https://www.owlposting.com/subscribe |
| Ground Truths | Eric Topol (Scripps) | 1–2x/week | Free (paid voluntary) | `substack.com` (custom: `erictopol.substack.com`) | 5 | Most-cited US clinical researcher on AI/genomics/clinical trials — name-drop currency in any pharma room. | https://erictopol.substack.com/ |
| AI Health Uncut | Sergei Polevikov | Weekly | Free + paid | `substack.com` (custom: `fixhealth.ai`) | 4 | Skeptical, contrarian take on health-AI hype — useful for spotting deals that won't survive due diligence. | https://sergeiai.substack.com/subscribe |
| The Week in Bio | Thomas Vanderstichele | Weekly | Free | `substack.com` (custom: `weekinbio.substack.com`) | 3 | Curated link roundup — papers, funding, AI-bio news. Good as a low-density backstop. | https://weekinbio.substack.com/ |
| Drug Discovery & Development AI track | WTWH Media | Weekly | Free | `drugdiscoverytrends.com` | 3 | Mainstream-trade lens on AI tooling in pharma R&D. | https://www.drugdiscoverytrends.com/sign-up-for-the-drug-discovery-development-enewsletter/ |

---

## Operational Notes for Dugout Ingestion

- **Sender-domain conflicts:** Endpoints uses both `endpts.com` and `endpointsnews.com` with ESP relays via `cmail1–20.com` and `createsend7.com` (Campaign Monitor). The classifier must dedupe across these. Same pattern likely for any Campaign-Monitor / Mailgun-hosted publisher.
- **Industry Dive family** (`biopharmadive.com`, `pharmavoice.com`, etc.) all share `industrydive.com` ESP — treat the publication name from the From line, not the relay domain.
- **Citeline (Pink Sheet, Scrip)** is enterprise-paid; ingestion will require a seat. Recommend skipping at MVP and relying on Endpoints + AgencyIQ for regulatory coverage.
- **Substack newsletters** all share `substack.com` as effective sender domain — the `from` localpart (e.g., `decodingbio@substack.com`) is the only disambiguator. Build a custom-domain → publication map.
- **Forwarding risk:** AgencyIQ and STAT+ have stricter ToS. Verify forwarding rights before piping to AgentMail webhook for redistribution; raw ingestion for internal classification is generally fine.
- **Paid sources flagged:** STAT+, Pink Sheet, Scrip, BioCentury, Axios Pro (Biotech Deals + Health Tech Deals), Timmerman Report. Total paid stack ~$5k–$50k/yr depending on tier.
