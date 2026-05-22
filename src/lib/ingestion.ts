import type { Account } from "./types";
import type { NewExternalSignal } from "./external-signals";
import { fetchSignalsForCompany } from "./news-adapter";
import { fetchSignalsForTicker, hasSecCoverage } from "./sec-adapter";

// Single entry point for ingesting external signals for one account. Fans
// out across all applicable adapters in parallel and merges the results.
//
// Today's adapters:
//   - news-adapter (NewsAPI + Haiku) — runs for every trackable account
//   - sec-adapter (EDGAR 8-K) — runs only when account.ticker is set AND
//     the ticker has a CIK mapping in sec-adapter
//
// Adding a new adapter is mechanical: add it to the Promise.all below, give
// it a key in PerSourceResult, push its signals into the merged array.
//
// Failure model: each adapter is wrapped in its own try; one adapter
// failing does NOT block the others. The wrapper throws only when EVERY
// applicable adapter fails — callers see a single error in that case.

export interface PerSourceResult {
  newsapi?: { count: number; error?: string };
  sec_edgar?: { count: number; error?: string };
}

export interface IngestionResult {
  signals: NewExternalSignal[];
  bySource: PerSourceResult;
}

type AdapterOutcome =
  | { ok: true; signals: NewExternalSignal[] }
  | { ok: false; error: string };

async function safeRun(
  promise: Promise<{ signals: NewExternalSignal[] }>,
): Promise<AdapterOutcome> {
  try {
    const r = await promise;
    return { ok: true, signals: r.signals };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function ingestAccount(
  account: Account,
): Promise<IngestionResult> {
  const newsPromise = safeRun(
    fetchSignalsForCompany(account.id, account.name, account.industry),
  );

  const runSec = hasSecCoverage(account.ticker);
  const secPromise: Promise<AdapterOutcome> | null = runSec
    ? safeRun(
        fetchSignalsForTicker(account.id, account.ticker!, account.name),
      )
    : null;

  const [newsOutcome, secOutcome] = await Promise.all([
    newsPromise,
    secPromise,
  ]);

  const bySource: PerSourceResult = {};
  const signals: NewExternalSignal[] = [];

  bySource.newsapi = newsOutcome.ok
    ? { count: newsOutcome.signals.length }
    : { count: 0, error: newsOutcome.error };
  if (newsOutcome.ok) signals.push(...newsOutcome.signals);

  if (secOutcome) {
    bySource.sec_edgar = secOutcome.ok
      ? { count: secOutcome.signals.length }
      : { count: 0, error: secOutcome.error };
    if (secOutcome.ok) signals.push(...secOutcome.signals);
  }

  // If every adapter we tried failed, surface that as an error to the
  // caller. Partial failures (one source down, another succeeded) return
  // a successful result with the failed source's error logged in bySource.
  const tried = [newsOutcome, secOutcome].filter(
    (o): o is AdapterOutcome => o !== null,
  );
  const allFailed = tried.length > 0 && tried.every((o) => !o.ok);
  if (allFailed) {
    const messages = tried
      .filter((o): o is { ok: false; error: string } => !o.ok)
      .map((o) => o.error)
      .join(" | ");
    throw new Error(`All ingestion sources failed: ${messages}`);
  }

  return { signals, bySource };
}
