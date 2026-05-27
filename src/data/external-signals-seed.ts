import type { ExternalSignal, ExternalSignalSource, ExternalSignalType } from "@/lib/external-signals";

// Seed for the drawer's "External signals" section, used as a fallback
// when the live NewsAPI / SEC EDGAR / AgentMail newsletter read returns
// nothing for an account in the lookback window.
//
// Two pools per account:
//   1. Account-specific: direct mentions in news, filings, or newsletters.
//   2. Vertical-relevant: industry events for the same vertical that
//      Haiku flagged as relevant context for the AE walking into a meeting.
//
// Verticals are Haiku-classified at account create-time. The classification
// is what unlocks the second pool: if Moderna's vertical is "Biotech &
// pharma," any inbound newsletter signal tagged with the same vertical
// surfaces here even when it doesn't mention Moderna by name.
//
// AgentMail is the inbound channel for the newsletter half of the pool —
// publisher domains in `INBOUND_SENDER_ALLOWLIST` flow through the
// classifier and land here when the vertical matches.

// ---------------------------------------------------------------------------
// Vertical map — what Haiku decided for each account. Surfaced at the top
// of the External signals section so the AE knows which vertical the news
// pool is being filtered against.
// ---------------------------------------------------------------------------

export const ACCOUNT_VERTICALS: Record<string, string> = {
  acc_sap: "Enterprise software",
  acc_hitachi: "Industrial · technology",
  acc_snowflake: "Data infrastructure",
  acc_kkr: "Financial services",
  acc_cna: "Insurance",
  acc_atlassian: "Enterprise software",
  acc_stripe: "Payments · fintech",
  acc_moderna: "Biotech & pharma",
  acc_unitedhealth: "Healthcare",
  acc_boeing: "Aerospace · defense",
  acc_conoco: "Energy",
  acc_adi: "Semiconductors",
  acc_ccep: "Beverages · CPG",
  acc_woolworths: "Retail",
};

export function getVerticalForAccount(accountId: string): string | null {
  return ACCOUNT_VERTICALS[accountId] ?? null;
}

// ---------------------------------------------------------------------------
// Per-account seed signals. Each account gets 2 account-specific items +
// 2-3 vertical-relevant items so toggling vertical filtering has visible
// effect.
// ---------------------------------------------------------------------------

interface SeedNews {
  date: string; // YYYY-MM-DD
  type: ExternalSignalType;
  source: ExternalSignalSource;
  publisher: string;
  summary: string;
  vertical_match: boolean; // false = account-specific; true = vertical-relevant
}

const PER_ACCOUNT: Record<string, SeedNews[]> = {
  acc_sap: [
    { date: "2026-05-22", type: "earnings", source: "newsapi", publisher: "Reuters", vertical_match: false, summary: "SAP Q1 cloud revenue beats; legal team expansion announced" },
    { date: "2026-05-16", type: "leadership_change", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "SAP names new EMEA General Counsel in 6-K filing" },
    { date: "2026-05-13", type: "product_launch", source: "newsapi", publisher: "TechCrunch", vertical_match: false, summary: "SAP unveils Joule agents for procurement and contract workflows at Sapphire" },
    { date: "2026-05-19", type: "ma_acquisition", source: "newsapi", publisher: "TechCrunch", vertical_match: true, summary: "Atlassian acquires AI-native legal startup for $300M" },
    { date: "2026-05-12", type: "other", source: "newsletter", publisher: "Lawyerist", vertical_match: true, summary: "Enterprise SaaS legal spend up 14% YoY across 200-company benchmark" },
  ],
  acc_hitachi: [
    { date: "2026-05-21", type: "ma_acquisition", source: "newsapi", publisher: "Bloomberg", vertical_match: false, summary: "Hitachi divests transportation unit, $5B" },
    { date: "2026-05-14", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "Hitachi 8-K: transportation unit divestiture closed" },
    { date: "2026-05-11", type: "other", source: "newsapi", publisher: "Nikkei", vertical_match: false, summary: "Hitachi to invest $3B in U.S. data-center manufacturing capacity" },
    { date: "2026-05-18", type: "regulatory_action", source: "newsapi", publisher: "Reuters", vertical_match: true, summary: "Siemens settles antitrust matter for $450M" },
    { date: "2026-05-09", type: "other", source: "newsletter", publisher: "Industrial Legal Brief", vertical_match: true, summary: "Industrial-tech legal ops 2026 benchmark study released" },
  ],
  acc_snowflake: [
    { date: "2026-05-22", type: "funding_round", source: "newsapi", publisher: "Forbes", vertical_match: false, summary: "Snowflake announces Series F at $40B valuation" },
    { date: "2026-05-15", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "Snowflake 10-K updates AI vendor disclosure" },
    { date: "2026-05-12", type: "product_launch", source: "newsapi", publisher: "The Register", vertical_match: false, summary: "Snowflake launches Cortex Studio with built-in vendor governance controls" },
    { date: "2026-05-20", type: "ma_acquisition", source: "newsapi", publisher: "The Information", vertical_match: true, summary: "Databricks acquires data-lineage startup for $180M" },
    { date: "2026-05-11", type: "other", source: "newsletter", publisher: "Bloomberg Law", vertical_match: true, summary: "Data infra legal teams under increased audit pressure" },
  ],
  acc_kkr: [
    { date: "2026-05-19", type: "funding_round", source: "newsapi", publisher: "Bloomberg", vertical_match: false, summary: "KKR closes $19B private equity fund" },
    { date: "2026-05-12", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "KKR 10-Q: legal spend up 12% YoY" },
    { date: "2026-05-09", type: "ma_acquisition", source: "newsapi", publisher: "Reuters", vertical_match: false, summary: "KKR completes $5B acquisition of CoolBlue from Investindustrial" },
    { date: "2026-05-21", type: "other", source: "newsapi", publisher: "PitchBook", vertical_match: true, summary: "Blackstone sets up dedicated AI vendor risk practice" },
    { date: "2026-05-08", type: "other", source: "newsletter", publisher: "PE Hub", vertical_match: true, summary: "PE firm legal-ops 2026 trends: outside counsel under squeeze" },
  ],
  acc_cna: [
    { date: "2026-04-25", type: "leadership_change", source: "newsapi", publisher: "WSJ", vertical_match: false, summary: "CNA names new CTO; legal team reorg pending" },
    { date: "2026-04-18", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "CNA 8-K: leadership transition disclosed" },
    { date: "2026-04-12", type: "earnings", source: "newsapi", publisher: "Insurance Journal", vertical_match: false, summary: "CNA Q1 underwriting income up 7% YoY; cyber line softens" },
    { date: "2026-05-20", type: "other", source: "newsapi", publisher: "Insurance Journal", vertical_match: true, summary: "Allstate adopts AI for claims compliance review" },
    { date: "2026-05-13", type: "other", source: "newsletter", publisher: "S&P Insurance Brief", vertical_match: true, summary: "Insurance legal-tech spending up 18% YoY" },
  ],
  acc_atlassian: [
    { date: "2026-05-19", type: "ma_acquisition", source: "newsapi", publisher: "TechCrunch", vertical_match: false, summary: "Atlassian acquires AI startup for $300M" },
    { date: "2026-05-13", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "Atlassian 10-K expands AI risk disclosure" },
    { date: "2026-05-08", type: "product_launch", source: "newsapi", publisher: "TechCrunch", vertical_match: false, summary: "Atlassian launches Rovo Agents for compliance and policy automation" },
    { date: "2026-05-22", type: "other", source: "newsapi", publisher: "ServiceNow", vertical_match: true, summary: "ServiceNow legal-ops case study highlights AI workflow gains" },
    { date: "2026-05-10", type: "other", source: "newsletter", publisher: "CLOC", vertical_match: true, summary: "SaaS legal team benchmarks 2026: headcount flat, AI spend doubled" },
  ],
  acc_stripe: [
    { date: "2026-05-18", type: "partnership", source: "newsapi", publisher: "Reuters", vertical_match: false, summary: "Stripe expands Asia-Pacific corridors" },
    { date: "2026-05-11", type: "regulatory_action", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "Stripe 10-Q discloses compliance reserve increase" },
    { date: "2026-05-06", type: "partnership", source: "newsapi", publisher: "Bloomberg", vertical_match: false, summary: "Stripe partners with OpenAI on enterprise payments rails for agent commerce" },
    { date: "2026-05-21", type: "regulatory_action", source: "newsapi", publisher: "Bloomberg", vertical_match: true, summary: "Block reaches settlement on consumer dispute, $400M" },
    { date: "2026-05-09", type: "other", source: "newsletter", publisher: "Fintech Law Report", vertical_match: true, summary: "Fintech regulatory landscape Q2 2026: state-level pressure rising" },
  ],
  acc_moderna: [
    { date: "2026-05-21", type: "earnings", source: "newsapi", publisher: "FierceBiotech", vertical_match: false, summary: "Moderna Q3 trial results expand mRNA pipeline" },
    { date: "2026-05-14", type: "leadership_change", source: "sec_edgar", publisher: "SEC EDGAR", vertical_match: false, summary: "Moderna 8-K: SVP Legal & Compliance hired" },
    { date: "2026-05-08", type: "partnership", source: "newsapi", publisher: "Endpoints News", vertical_match: false, summary: "Moderna and CytomX expand cancer drug partnership in $400M deal" },
    { date: "2026-05-22", type: "regulatory_action", source: "newsapi", publisher: "Endpoints News", vertical_match: true, summary: "FDA expands AI vendor guidance for clinical trials" },
    { date: "2026-05-17", type: "regulatory_action", source: "newsapi", publisher: "FiercePharma", vertical_match: true, summary: "Pfizer settles patent dispute for $200M" },
    { date: "2026-05-10", type: "other", source: "newsletter", publisher: "BioPharma Dive", vertical_match: true, summary: "Biotech legal spend up 14% YoY; AI vendor adoption accelerating" },
  ],
};

// ---------------------------------------------------------------------------
// Materialize seed into ExternalSignal rows.
// ---------------------------------------------------------------------------

function toSignal(
  accountId: string,
  i: number,
  n: SeedNews,
): ExternalSignal {
  return {
    id: `seed_ext_${accountId}_${i}`,
    account_id: accountId,
    source: n.source,
    type: n.type,
    summary: n.summary,
    occurred_at: n.date + "T12:00:00Z",
    created_at: n.date + "T12:00:00Z",
    url: null,
    is_demo: false,
    publisher_canonical_name: n.publisher,
    source_url: null,
    inbound_email_id: null,
    email_subject: null,
    suppressed_at: null,
    source_content_md: null,
    source_content_kind: null,
    workspace_relevance: n.vertical_match ? "medium" : "high",
    meta: {
      vertical_match: n.vertical_match,
      vertical: n.vertical_match ? ACCOUNT_VERTICALS[accountId] ?? null : null,
      source_name: n.publisher,
      classifier: "haiku",
    },
  };
}

const BY_ACCOUNT: Map<string, ExternalSignal[]> = (() => {
  const m = new Map<string, ExternalSignal[]>();
  for (const [accountId, items] of Object.entries(PER_ACCOUNT)) {
    m.set(
      accountId,
      items
        .map((n, i) => toSignal(accountId, i, n))
        // Account-specific (vertical_match=false) first, then vertical, both newest first.
        .sort((a, b) => {
          const av = (a.meta as { vertical_match?: boolean })?.vertical_match
            ? 1
            : 0;
          const bv = (b.meta as { vertical_match?: boolean })?.vertical_match
            ? 1
            : 0;
          if (av !== bv) return av - bv;
          return a.occurred_at < b.occurred_at ? 1 : -1;
        }),
    );
  }
  return m;
})();

export function getSeedSignalsForAccount(
  accountId: string,
): ExternalSignal[] {
  return BY_ACCOUNT.get(accountId) ?? [];
}
