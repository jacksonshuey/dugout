import { NextResponse } from "next/server";
import { accounts } from "@/data/seed";
import {
  getUnclassifiedInboundEmails,
  markClassified,
} from "@/lib/inbound-email";
import { classifyNewsletter } from "@/lib/newsletter-adapter";
import { insertSignalsDedup } from "@/lib/external-signals";

// Backfill sweeper for the newsletter inbox.
//
// The webhook (src/app/api/inbound-email/[secret]/route.ts) runs Haiku
// classification inline on every POST. When that fails — Anthropic 529,
// Supabase write race, or a Haiku response we couldn't parse — the row is
// still stored but classified_at stays NULL. This route drains that queue
// on a cron schedule so a transient outage doesn't permanently strand
// material signals.
//
// Auth: CRON_SECRET (Vercel injects "Authorization: Bearer ${CRON_SECRET}").
// Fail-closed when the env var is missing, same as the external-signals cron.
//
// Batching: ten rows per run. Each row is one Haiku call (~3s) so ten fits
// comfortably under the Vercel Hobby 60s cap with headroom. Cron schedule
// (in vercel.json) is hourly — most days this finds nothing to do and exits
// in milliseconds.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH_SIZE = 10;

interface RowResult {
  id: string;
  from_domain: string;
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
  picked: number;
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

async function classifyOne(
  email: Awaited<ReturnType<typeof getUnclassifiedInboundEmails>>[number],
  trackable: typeof accounts,
): Promise<RowResult> {
  const t0 = Date.now();
  try {
    const result = await classifyNewsletter(email, trackable);
    if (result.signals.length > 0) {
      await insertSignalsDedup(result.signals);
    }
    await markClassified(email.id, result.signals.length);
    return {
      id: email.id,
      from_domain: email.from_domain,
      status: "success",
      signalsEmitted: result.signals.length,
      matched: result.matched,
      workspace: result.workspace,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      id: email.id,
      from_domain: email.from_domain,
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
  let pending: Awaited<ReturnType<typeof getUnclassifiedInboundEmails>>;
  try {
    pending = await getUnclassifiedInboundEmails(BATCH_SIZE);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  if (pending.length === 0) {
    const result: SweeperResult = {
      ranAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startedAt,
      picked: 0,
      results: [],
      summary: { succeeded: 0, errored: 0, signalsTotal: 0 },
    };
    return NextResponse.json(result);
  }

  const trackable = accounts.filter((a) => a.trackable);
  // Sequential, not parallel — Haiku rate limits and the per-row dedup
  // query are happier serialized. 10 × ~3s = 30s, well under maxDuration.
  const results: RowResult[] = [];
  for (const row of pending) {
    results.push(await classifyOne(row, trackable));
  }

  const result: SweeperResult = {
    ranAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startedAt,
    picked: pending.length,
    results,
    summary: {
      succeeded: results.filter((r) => r.status === "success").length,
      errored: results.filter((r) => r.status === "error").length,
      signalsTotal: results.reduce((s, r) => s + (r.signalsEmitted ?? 0), 0),
    },
  };
  console.log(
    `[classify-pending] swept ${pending.length} rows: ${result.summary.succeeded} ok, ${result.summary.errored} err, ${result.summary.signalsTotal} signals in ${result.totalDurationMs}ms`,
  );
  return NextResponse.json(result);
}

export async function POST(req: Request) {
  return GET(req);
}
