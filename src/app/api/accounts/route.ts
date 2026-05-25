import { NextResponse, type NextRequest } from "next/server";
import { insertAccount } from "@/lib/accounts";
import { scrapeAccount } from "@/lib/firecrawl-adapter";
import { requireUiSession } from "@/lib/ui-auth-server";
import type { Account } from "@/lib/types";

// POST /api/accounts — onboard a new tracked account.
//
// Two things matter here:
//
// 1. The insert is synchronous + awaited (caller needs the new id).
//
// 2. The first Firecrawl scrape is fire-and-forget. Before Phase 4,
//    a new account waited until the next 6am cron to get its first
//    scrape — an account added at 8:30am sat with zero data for ~21.5h,
//    which is vision-blocking for the AE. Now we kick off the scrape
//    immediately and return 201 within <500ms; the scrape runs in the
//    background and populates web_scrapes whenever it completes
//    (typically 5-30s later, depending on /map + page render latency).
//
//    Caveat: serverless function lifetime is bounded by maxDuration. On
//    Vercel, a fire-and-forget without `waitUntil` may be cut short when
//    the response is returned. We accept that risk for v1 — if the
//    background scrape gets killed, the next 6am cron picks the account
//    up (it's now `trackable: true` in the DB). A future iteration
//    should use `waitUntil` (Vercel) or enqueue to a real job runner.
//
// Auth: requireUiSession() — same gate as the rest of /api/*. The route
// is operator-facing; no public form.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Long enough that the immediate scrape, if it doesn't get cut, has room
// to finish before the function is terminated. 60s is conservative —
// /map + 6 /scrape calls in parallel typically completes in 10-15s.
export const maxDuration = 60;

interface PostBody {
  name?: unknown;
  website?: unknown;
  industry?: unknown;
  segment?: unknown;
  ticker?: unknown;
  domain?: unknown;
  paths?: unknown;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const cleaned = v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeWebsite(input: string): string | null {
  // Allow either "stripe.com" or "https://stripe.com" — normalize to a
  // parseable URL. Reject if URL constructor fails or the host is empty.
  const candidate = input.startsWith("http") ? input : `https://${input}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.host) return null;
    return parsed.host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = asString(body.name);
  const websiteRaw = asString(body.website);
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (!websiteRaw) {
    return NextResponse.json({ error: "website required" }, { status: 400 });
  }

  const domain = normalizeWebsite(websiteRaw);
  if (!domain) {
    return NextResponse.json(
      { error: "website is not a parseable URL" },
      { status: 400 },
    );
  }

  let account: Account;
  try {
    account = await insertAccount({
      name,
      // Persist the apex domain — keeps `website` clean for the adapter's
      // URL builder, which prepends https:// itself.
      website: domain,
      domain,
      industry: asString(body.industry),
      segment: asString(body.segment),
      ticker: asString(body.ticker),
      paths: asStringArray(body.paths),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Fire-and-forget immediate scrape. We intentionally do NOT await.
  // Errors are swallowed (logged) — the new account is already in the
  // DB with trackable=true, so the next daily cron will retry. A 429
  // here just means the AE sees zero data until 6am — that's a known
  // gap documented in the route comment.
  void scrapeAccount(account).catch((e) => {
    console.warn(
      `[api/accounts] background scrape failed for ${account.name} (${account.id})`,
      e instanceof Error ? e.message : String(e),
    );
  });

  return NextResponse.json(
    {
      accountId: account.id,
      name: account.name,
      scrapeQueued: true,
    },
    { status: 201 },
  );
}
