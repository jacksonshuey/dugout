import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import { buildMeetingBrief } from "@/lib/meeting-prep";
import { accounts as seedAccounts } from "@/data/seed";
import { listTrackableAccounts } from "@/lib/accounts";
import { scrapeAccount } from "@/lib/firecrawl-adapter";

// GET /api/firecrawl/company-scope?accountId=<id>
//
// Returns the structured MeetingBrief shape consumed by:
//   - the /account/[slug]/prep server-rendered page (in-process - the page
//     calls buildMeetingBrief directly per BUILD_ALIGNMENT principle #7;
//     this route is the HTTP boundary for external callers)
//   - the Phase 6 Claude Code skill (.claude/skills/) that surfaces the
//     brief to AEs from outside the web UI
//
// Auth: dual-path.
//   1. UI session cookie (requireUiSession) - same gate as every other
//      /api route. This covers the in-product /account/[slug]/prep page.
//   2. Bearer token (Authorization: Bearer <DUGOUT_SKILL_TOKEN>) - used
//      by the Phase 6 Claude Code skill (.claude/skills/firecrawl-company-
//      scope/SKILL.md) so an AE can pull the same brief from the CLI
//      without a browser session. If DUGOUT_SKILL_TOKEN is unset in env,
//      this path is disabled and the route falls back to UI-session-only
//      (preserves existing behavior for deployments that haven't opted in).
//
// Behaviour:
//   - scrapeStatus === "missing" (account has no website) → 404 with a
//     helpful message
//   - scrapeStatus === "pending" (account exists, no scrape yet) → kick
//     off a fire-and-forget scrapeAccount() call and return the brief
//     with scrapeStatus: "pending" so the caller knows data is incomplete
//   - otherwise → return the brief JSON
//
// Vercel serverless caveat: a plain `void scrapeAccount(...)` may be
// killed mid-flight when the function returns. The recommended fix is
// `waitUntil(scrapeAccount(...))` from `@vercel/functions`, but that
// package is NOT currently in package.json - flagged in the Phase 5
// report. Until it's added, we use the void-call pattern and rely on
// the next cron sweep (src/app/api/cron/firecrawl/route.ts) to pick up
// any accounts that haven't been scraped yet. This is acceptable for
// the demo because the seed accounts always have at least one scrape
// in Supabase by the time the brief is requested.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Guard against running the same scrape repeatedly when the brief is
// polled in quick succession. In-memory map keyed by accountId →
// last-kicked-at timestamp. Process-local (fine; if a different
// instance picks up the next request it'll dedup via the web_scrapes
// unique constraint on (account_id, url, scraped_date) anyway).
const RECENT_SCRAPE_KICK_MS = 60_000;
const recentScrapeKicks = new Map<string, number>();

function shouldKickScrape(accountId: string): boolean {
  const last = recentScrapeKicks.get(accountId);
  if (!last) return true;
  return Date.now() - last > RECENT_SCRAPE_KICK_MS;
}

function markScrapeKicked(accountId: string): void {
  recentScrapeKicks.set(accountId, Date.now());
}

// Constant-time bearer-token check. Returns true iff the request carries
// `Authorization: Bearer <DUGOUT_SKILL_TOKEN>` and the env var is set. We
// use timingSafeEqual on Buffers of equal length to avoid leaking token
// length via early-exit string comparison.
function hasValidSkillToken(req: NextRequest): boolean {
  const skillToken = process.env.DUGOUT_SKILL_TOKEN;
  if (!skillToken || skillToken.length === 0) return false;
  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  const a = Buffer.from(presented);
  const b = Buffer.from(skillToken);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  // Skip the UI-session guard when a valid skill bearer token is presented.
  if (!hasValidSkillToken(req)) {
    const guard = await requireUiSession();
    if (guard) return guard;
  }

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId || accountId.trim().length === 0) {
    return NextResponse.json(
      { error: "accountId query param required" },
      { status: 400 },
    );
  }

  try {
    const brief = await buildMeetingBrief(accountId);

    if (brief.scrapeStatus === "missing") {
      return NextResponse.json(
        {
          error: "account has no website on file - cannot build a meeting brief",
          accountId,
        },
        { status: 404 },
      );
    }

    if (brief.scrapeStatus === "pending" && shouldKickScrape(accountId)) {
      // Resolve the Account row so we can hand it to scrapeAccount.
      // Try seed first (covers all demo accounts), then DB.
      let account =
        seedAccounts.find((a) => a.id === accountId) ?? null;
      if (!account) {
        try {
          const dbAccounts = await listTrackableAccounts();
          account = dbAccounts.find((a) => a.id === accountId) ?? null;
        } catch {
          // ignore - fall through and skip the kick
        }
      }
      if (account && account.website) {
        markScrapeKicked(accountId);
        // Fire-and-forget: the call returns a promise we deliberately
        // don't await. See module comment re: waitUntil.
        scrapeAccount(account).catch((e) => {
          // Best-effort logging; don't surface to the caller.
          console.warn(
            `[company-scope] background scrapeAccount failed for ${accountId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        });
      }
    }

    return NextResponse.json(brief);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
