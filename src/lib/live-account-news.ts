import { accounts } from "@/data/seed";
import type { ExternalSignal } from "./external-signals";
import { fetchFilingHeadlines, hasSecCoverage } from "./sec-adapter";

// Live news for the landing page, pulled straight off the real seed companies
// via SEC EDGAR (keyless, authoritative — each company's own 8-K filings). No
// API keys, no fabricated data: this is the "real working product" view the
// dashboard's tracked accounts would actually surface.
//
// Cached in-module with a short TTL so the 30s ticker poll and the Top-news
// feed share one EDGAR sweep instead of re-fetching per request. (EDGAR
// responses are also cached at the fetch layer via `next: { revalidate }`.)

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; data: ExternalSignal[] } | null = null;
let inflight: Promise<ExternalSignal[]> | null = null;

async function load(): Promise<ExternalSignal[]> {
  const covered = accounts.filter(
    (a) => a.trackable && hasSecCoverage(a.ticker),
  );
  const batches = await Promise.all(
    covered.map(async (a) => {
      try {
        return await fetchFilingHeadlines(a.id, a.ticker as string, a.name);
      } catch {
        return [] as ExternalSignal[];
      }
    }),
  );
  return batches
    .flat()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
}

export async function getLiveAccountNews(): Promise<ExternalSignal[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = load()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
