import { accounts } from "@/data/seed";
import {
  getUnclassifiedInboundEmails,
  markClassified as markInboundClassified,
} from "@/lib/inbound-email";
import {
  getUnclassifiedWebScrapes,
  markWebScrapeClassified,
} from "@/lib/web-scrapes";
import { classifyNewsletter } from "@/lib/newsletter-adapter";
import { classifyWebScrape } from "@/lib/web-scrape-classifier";
import { insertSignalsDedup } from "@/lib/external-signals";
import { resolvePublisher } from "@/lib/inbound-publishers";
import { filterEmail } from "@/lib/email-filter";

// Shared sweeper for the classify-pending queue. Powers both:
//   - the daily Vercel cron at /api/cron/classify-pending (CRON_SECRET-gated)
//   - the admin manual trigger at /api/admin/classify-pending (UI-session-gated)
//
// Drains TWO independent unclassified queues — inbound_emails (newsletters)
// and web_scrapes — in batches. Each row is handled in its own try/catch so a
// single Haiku 5xx or Supabase blip cannot poison the whole sweep.

const DEFAULT_BATCH_SIZE = 10;

type Kind = "inbound_email" | "web_scrape";

export interface RowResult {
  kind: Kind;
  id: string;
  source_label: string;
  status: "success" | "error";
  signalsEmitted?: number;
  matched?: number;
  workspace?: number;
  error?: string;
  durationMs: number;
}

export interface SweeperResult {
  ranAt: string;
  totalDurationMs: number;
  picked: { inbound_email: number; web_scrape: number };
  results: RowResult[];
  summary: {
    succeeded: number;
    errored: number;
    signalsTotal: number;
  };
}

async function classifyInbound(
  email: Awaited<ReturnType<typeof getUnclassifiedInboundEmails>>[number],
  trackable: typeof accounts,
): Promise<RowResult> {
  const t0 = Date.now();
  try {
    const publisherInfo = resolvePublisher({
      list_id: email.list_id ?? null,
      sender_domain: email.from_domain,
    });
    const filterResult = await filterEmail({
      email,
      publisherInfo,
      now: new Date(),
    });

    if (filterResult.decision !== "proceed") {
      await markInboundClassified(email.id, 0);
      return {
        kind: "inbound_email",
        id: email.id,
        source_label: email.from_domain,
        status: "success",
        signalsEmitted: 0,
        matched: 0,
        workspace: 0,
        durationMs: Date.now() - t0,
      };
    }

    const result = await classifyNewsletter(email, trackable, publisherInfo);
    if (result.signals.length > 0) {
      await insertSignalsDedup(result.signals);
    }
    await markInboundClassified(
      email.id,
      result.signals.length,
      result.classifier_error ?? null,
    );
    return {
      kind: "inbound_email",
      id: email.id,
      source_label: email.from_domain,
      status: "success",
      signalsEmitted: result.signals.length,
      matched: result.matched,
      workspace: result.workspace,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      kind: "inbound_email",
      id: email.id,
      source_label: email.from_domain,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - t0,
    };
  }
}

async function classifyScrape(
  scrape: Awaited<ReturnType<typeof getUnclassifiedWebScrapes>>[number],
  accountsById: Map<string, (typeof accounts)[number]>,
): Promise<RowResult> {
  const t0 = Date.now();
  const account = accountsById.get(scrape.account_id);
  if (!account) {
    await markWebScrapeClassified(scrape.id, 0).catch(() => undefined);
    return {
      kind: "web_scrape",
      id: scrape.id,
      source_label: scrape.url,
      status: "error",
      error: `Account ${scrape.account_id} not in seed`,
      durationMs: Date.now() - t0,
    };
  }
  try {
    const result = await classifyWebScrape(scrape, account);
    if (result.signals.length > 0) {
      await insertSignalsDedup(result.signals);
    }
    await markWebScrapeClassified(scrape.id, result.signals.length);
    return {
      kind: "web_scrape",
      id: scrape.id,
      source_label: scrape.url,
      status: "success",
      signalsEmitted: result.signals.length,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      kind: "web_scrape",
      id: scrape.id,
      source_label: scrape.url,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - t0,
    };
  }
}

export interface RunSweepOptions {
  batchSize?: number;
  // Limit which queues run. Useful for the admin "drain inbox only" trigger.
  includeWebScrapes?: boolean;
}

export async function runClassifyPendingSweep(
  opts: RunSweepOptions = {},
): Promise<SweeperResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const includeWebScrapes = opts.includeWebScrapes ?? true;

  const startedAt = Date.now();

  const [inboundPending, scrapePending] = await Promise.all([
    getUnclassifiedInboundEmails(batchSize),
    includeWebScrapes
      ? getUnclassifiedWebScrapes(batchSize)
      : Promise.resolve([] as Awaited<ReturnType<typeof getUnclassifiedWebScrapes>>),
  ]);

  const trackable = accounts.filter((a) => a.trackable);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // Sequential per row (Haiku rate limits + dedup queries serialize cleanly).
  const results: RowResult[] = [];
  for (const row of inboundPending) {
    results.push(await classifyInbound(row, trackable));
  }
  for (const row of scrapePending) {
    results.push(await classifyScrape(row, accountsById));
  }

  const result: SweeperResult = {
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startedAt,
    picked: {
      inbound_email: inboundPending.length,
      web_scrape: scrapePending.length,
    },
    results,
    summary: {
      succeeded: results.filter((r) => r.status === "success").length,
      errored: results.filter((r) => r.status === "error").length,
      signalsTotal: results.reduce((s, r) => s + (r.signalsEmitted ?? 0), 0),
    },
  };
  console.log(
    `[classify-pending] swept ${inboundPending.length} inbound + ${scrapePending.length} scrapes: ${result.summary.succeeded} ok, ${result.summary.errored} err, ${result.summary.signalsTotal} signals in ${result.totalDurationMs}ms`,
  );
  return result;
}
