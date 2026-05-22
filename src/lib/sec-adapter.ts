import type { ExternalSignalType, NewExternalSignal } from "./external-signals";

// SEC EDGAR adapter — fetches recent 8-K filings for public-company accounts
// and maps the filing's Item codes into ExternalSignal rows.
//
// Why 8-K specifically: it's the form companies file when something material
// happens between scheduled reports — acquisitions, earnings, executive
// departures, layoffs/restructuring, material agreements. By definition the
// "material events" form. 10-K / 10-Q (annual / quarterly) are noise for
// sales because by the time those file the AE already knows.
//
// Why this beats NewsAPI for public-co coverage: authoritative (the company
// filed it themselves), free, no LLM dependency, no rate limit pain, no
// classifier ambiguity. EDGAR is the source of truth that journalists rewrite.

const EDGAR_SUBMISSIONS = "https://data.sec.gov/submissions";
const EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data";

// SEC requires a unique User-Agent on all programmatic requests. Without one
// they will 403 or rate-limit aggressively. Identifies Dugout as the caller
// with a contact address.
const USER_AGENT =
  "Dugout (dugout-pi.vercel.app jacksonshuey@gmail.com)";

const LOOKBACK_DAYS = 90;
const REQUEST_TIMEOUT_MS = 10_000;

// Ticker → CIK (Central Index Key) map. Hardcoded for the two public-co
// accounts in seed today (SNOW, TEAM). At this scale, hardcoding beats
// fetching SEC's ~700KB company-tickers.json on every cron run. If we add
// more tickers, switch to a fetch-once-cache-in-module strategy.
const TICKER_TO_CIK: Record<string, string> = {
  SNOW: "0001640147", // Snowflake Inc.
  TEAM: "0001650372", // Atlassian Corporation
};

// 8-K Item code → signal classification + human label. Codes from SEC Form 8-K
// instructions. Ordered by sales-team materiality: when a single filing
// carries multiple items, the first match wins as the primary classification.
// Item 9.01 ("Financial Statements and Exhibits") is procedural — it just
// declares that exhibits are attached — and is excluded from priority lookup
// so it doesn't shadow the real material item it's paired with.
const ITEM_PRIORITY: {
  code: string;
  type: ExternalSignalType;
  label: string;
}[] = [
  { code: "2.01", type: "ma_acquisition", label: "Acquisition or disposition completed" },
  { code: "5.01", type: "ma_acquisition", label: "Change in control" },
  { code: "5.02", type: "leadership_change", label: "Director or officer change" },
  { code: "2.05", type: "layoff", label: "Restructuring or exit costs" },
  { code: "2.02", type: "earnings", label: "Results of operations" },
  { code: "1.03", type: "regulatory_action", label: "Bankruptcy or receivership" },
  { code: "4.01", type: "regulatory_action", label: "Auditor change" },
  { code: "4.02", type: "regulatory_action", label: "Non-reliance on prior financials" },
  { code: "1.01", type: "partnership", label: "Material agreement entered" },
  { code: "1.02", type: "other", label: "Material agreement terminated" },
  { code: "2.03", type: "other", label: "New financial obligation" },
  { code: "2.04", type: "regulatory_action", label: "Obligations accelerated" },
  { code: "2.06", type: "other", label: "Material impairment" },
  { code: "3.01", type: "other", label: "Listing status change" },
  { code: "3.02", type: "other", label: "Unregistered securities sold" },
  { code: "3.03", type: "other", label: "Rights of security holders modified" },
  { code: "5.03", type: "other", label: "Articles or bylaws amended" },
  { code: "5.07", type: "other", label: "Shareholder vote results" },
  { code: "7.01", type: "press_release", label: "Regulation FD disclosure" },
  { code: "8.01", type: "other", label: "Other events" },
];

interface EdgarSubmissions {
  cik?: string;
  name?: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      items?: string[];
    };
  };
}

export interface AdapterResult {
  signals: NewExternalSignal[];
  rawResponseLength: number; // number of 8-K filings within the lookback window
}

// Normalize "Item 2.02,Item 9.01" / "2.02, 9.01" / "2.02,9.01" → ["2.02", "9.01"].
function parseItemCodes(itemsField: string): string[] {
  if (!itemsField) return [];
  return itemsField
    .replace(/Item\s+/gi, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pick the most material item present for classification. Skips 9.01 since
// it's a procedural code that almost always accompanies another item.
function classifyFiling(itemCodes: string[]): {
  type: ExternalSignalType;
  primaryLabel: string;
} {
  const materialCodes = itemCodes.filter((c) => c !== "9.01");
  for (const priority of ITEM_PRIORITY) {
    if (materialCodes.includes(priority.code)) {
      return { type: priority.type, primaryLabel: priority.label };
    }
  }
  return { type: "other", primaryLabel: "8-K filing" };
}

// Build a human summary that names every material item in the filing, so a
// 2.05+5.02 combined filing reads as "restructuring costs and director or
// officer change" rather than just the primary classification.
function buildSummary(companyName: string, itemCodes: string[]): string {
  const labels: string[] = [];
  for (const code of itemCodes) {
    if (code === "9.01") continue;
    const match = ITEM_PRIORITY.find((p) => p.code === code);
    if (match) labels.push(match.label);
  }
  if (labels.length === 0) {
    return `${companyName} filed an 8-K with the SEC.`;
  }
  // Keep labels in their original case so acronyms like "FD" survive. The
  // result reads as a list of noun phrases mid-sentence: a bit loose
  // grammatically but never mangles SEC terminology.
  const itemList =
    labels.length === 1
      ? labels[0]
      : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1];
  return `${companyName} filed an 8-K covering ${itemList}.`;
}

function buildFilingUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument?: string,
): string {
  const cikNoLeadingZeros = String(parseInt(cik, 10));
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (primaryDocument) {
    return `${EDGAR_ARCHIVES}/${cikNoLeadingZeros}/${accNoDashes}/${primaryDocument}`;
  }
  return `${EDGAR_ARCHIVES}/${cikNoLeadingZeros}/${accNoDashes}/`;
}

export function hasSecCoverage(ticker: string | undefined): boolean {
  if (!ticker) return false;
  return ticker.toUpperCase() in TICKER_TO_CIK;
}

export async function fetchSignalsForTicker(
  accountId: string,
  ticker: string,
  companyName: string,
  lookbackDays: number = LOOKBACK_DAYS,
): Promise<AdapterResult> {
  const cik = TICKER_TO_CIK[ticker.toUpperCase()];
  if (!cik) {
    throw new Error(`No EDGAR CIK mapping for ticker "${ticker}"`);
  }

  const url = `${EDGAR_SUBMISSIONS}/CIK${cik}.json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let data: EdgarSubmissions;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`EDGAR ${res.status}: ${res.statusText}`);
    }
    data = (await res.json()) as EdgarSubmissions;
  } finally {
    clearTimeout(timeout);
  }

  const recent = data.filings?.recent;
  if (!recent || !recent.form) {
    console.log(`[sec-adapter] ${ticker}: no recent filings array`);
    return { signals: [], rawResponseLength: 0 };
  }

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const signals: NewExternalSignal[] = [];
  let eightKCount = 0;
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.form[i] !== "8-K") continue;
    const filingDate = recent.filingDate?.[i] ?? "";
    if (filingDate < cutoff) continue;
    eightKCount++;
    const accession = recent.accessionNumber?.[i] ?? "";
    const itemsField = recent.items?.[i] ?? "";
    const primaryDoc = recent.primaryDocument?.[i];

    const itemCodes = parseItemCodes(itemsField);
    const { type } = classifyFiling(itemCodes);
    const summary = buildSummary(companyName, itemCodes);

    signals.push({
      account_id: accountId,
      source: "sec_edgar",
      type,
      summary,
      occurred_at: `${filingDate}T00:00:00Z`,
      url: accession ? buildFilingUrl(cik, accession, primaryDoc) : null,
      meta: {
        source_name: "SEC EDGAR",
        accession,
        items: itemsField,
        form: "8-K",
      },
      is_demo: false,
    });
  }

  console.log(
    `[sec-adapter] ${ticker}: ${eightKCount} 8-K filing${eightKCount === 1 ? "" : "s"} in last ${lookbackDays}d`,
  );

  return { signals, rawResponseLength: eightKCount };
}
