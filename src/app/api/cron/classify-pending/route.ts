import { NextResponse } from "next/server";
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

// Backfill sweeper - drains TWO unclassified queues on the same schedule:
//   1. inbound_emails (newsletters arriving via the AgentMail webhook).
//      Webhook attempts inline Haiku classification on every POST; this
//      cron catches rows where that failed (Anthropic 529, parse error,
//      Supabase blip).
//   2. web_scrapes (per-account markdown blobs from the Firecrawl cron).
//      Firecrawl cron only fills the queue - all classification happens
//      here, by explicit design (resilience + re-classify-as-prompt-evolves).
//
// Auth: CRON_SECRET (Vercel injects "Authorization: Bearer ${CRON_SECRET}").
// Fail-closed when the env var is missing.
//
// Batching: 10 rows per queue per run. Each row is one Haiku call (~3s)
// so 20 rows × ~3s = ~60s, fitting under maxDuration with headroom.
// Hobby plan caps crons at once-per-day; upgrade to Pro and tighten this
// to hourly if realtime classification matters.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BATCH_SIZE = 10;

type Kind = "inbound_email" | "web_scrape";

interface RowResult {
  kind: Kind;
  id: string;
  source_label: string; // from_domain or scraped url
  status: "success" | "error";
  signalsEmitted?: number;
  matched?: number;
  workspace?: number;
  error?: string;
  durationMs: number;
}

interface SweeperResult {
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

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  return req.headers.get("authorization") === `Bearer ${required}`;
}

async function classifyInbound(
  email: Awaited<ReturnType<typeof getUnclassifiedInboundEmails>>[number],
  trackable: typeof accounts,
): Promise<RowResult> {
  const t0 = Date.now();
  try {
    // Same filter + classify pipeline as the inline webhook path. The
    // sweeper has no raw headers to forward - Stage 1's auto-reply /
    // bounce / calendar checks degrade to "no headers, no header-based
    // rejection." Subject + body rules still apply.
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
    await markInboundClassified(email.id, result.signals.length);
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
    // Orphaned scrape (account removed from seed). Mark it classified with
    // zero signals so it stops re-appearing in the queue.
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

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();

  let inboundPending: Awaited<ReturnType<typeof getUnclassifiedInboundEmails>>;
  let scrapePending: Awaited<ReturnType<typeof getUnclassifiedWebScrapes>>;
  try {
    [inboundPending, scrapePending] = await Promise.all([
      getUnclassifiedInboundEmails(BATCH_SIZE),
      getUnclassifiedWebScrapes(BATCH_SIZE),
    ]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  const trackable = accounts.filter((a) => a.trackable);
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // Sequential per row (Haiku rate limits + dedup queries serialize cleanly).
  // Drain inbound first, then scrapes - inbound is push-driven and more
  // latency-sensitive (workspace-wide market intel).
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
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
