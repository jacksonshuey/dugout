import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import { listTrackableAccounts } from "@/lib/accounts";
import { accounts as seedAccounts } from "@/data/seed";
import type { Account } from "@/lib/types";

// GET /api/accounts/lookup?q=<name-or-slug-or-domain>
//
// Name → accountId resolver for the Phase 6 Claude Code skill. The skill
// takes a freeform string from the AE ("Stripe", "STRIPE", "stripe.com",
// "acc_cobalt") and needs to map it to a stable accountId before calling
// /api/firecrawl/company-scope.
//
// Why a separate endpoint vs extending /api/accounts: /api/accounts is
// POST-only (owned by Phase 4 onboarding); adding a GET there would
// muddy the route's contract. This route is a pure read.
//
// Data sources:
//   - DB: listTrackableAccounts() - production-added accounts (Phase 4)
//   - Seed: src/data/seed.ts accounts - the 11 demo accounts that
//     buildMeetingBrief also falls back to (see meeting-prep.ts:resolveAccount).
//
// Match heuristic:
//   - exact (case-insensitive) on id, slug-like id, or ticker
//   - case-insensitive prefix on name
//   - domain ends-with on website / domain
//
// Auth: dual-path (UI session cookie OR DUGOUT_SKILL_TOKEN bearer) - same
// pattern as /api/firecrawl/company-scope so the skill can call both with
// a single header.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MATCHES = 5;

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

function normalizeDomain(input: string): string {
  // Strip protocol + leading www. + trailing slash. Returns lowercase host.
  let s = input.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.replace(/\/.*$/, "");
  return s;
}

function matchesAccount(account: Account, q: string): boolean {
  const qLower = q.toLowerCase().trim();
  if (qLower.length === 0) return false;

  // Exact id / ticker matches (handles "acc_cobalt", "STRIPE", "SNOW")
  if (account.id.toLowerCase() === qLower) return true;
  if (account.ticker && account.ticker.toLowerCase() === qLower) return true;

  // Name prefix match (case-insensitive). Use prefix so "Sn" matches
  // Snowflake but "Inc" doesn't match every "X, Inc".
  if (account.name.toLowerCase().startsWith(qLower)) return true;

  // Domain match: the query might be "stripe.com" or "https://stripe.com/x".
  // Compare normalized forms with endsWith so subdomains still resolve to
  // their apex-domain account.
  const qDomain = normalizeDomain(qLower);
  if (qDomain.length > 0 && qDomain.includes(".")) {
    if (account.website && normalizeDomain(account.website) === qDomain) {
      return true;
    }
    if (account.domain && account.domain.toLowerCase() === qDomain) {
      return true;
    }
    // Subdomain → apex fallback (e.g. "blog.stripe.com" → "stripe.com")
    if (account.website && qDomain.endsWith("." + normalizeDomain(account.website))) {
      return true;
    }
  }

  return false;
}

interface LookupMatch {
  id: string;
  name: string;
  website: string; // empty string when the account has no website on file
}

function toMatch(account: Account): LookupMatch {
  return {
    id: account.id,
    name: account.name,
    website: account.website ?? "",
  };
}

export async function GET(req: NextRequest) {
  if (!hasValidSkillToken(req)) {
    const guard = await requireUiSession();
    if (guard) return guard;
  }

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length === 0) {
    return NextResponse.json(
      { error: "q query param required" },
      { status: 400 },
    );
  }

  // Pull DB accounts (failsoft - empty list on Supabase trouble so the
  // skill still resolves seed-only matches in local dev).
  let dbAccounts: Account[] = [];
  try {
    dbAccounts = await listTrackableAccounts();
  } catch {
    dbAccounts = [];
  }

  // Combine seed + DB, dedup by id (seed wins on collision - the demo
  // accounts use stable `acc_<name>` ids that DB uuid inserts can't
  // collide with, but defensive dedup is cheap).
  const byId = new Map<string, Account>();
  for (const a of seedAccounts) byId.set(a.id, a);
  for (const a of dbAccounts) if (!byId.has(a.id)) byId.set(a.id, a);

  const matches: LookupMatch[] = [];
  for (const account of byId.values()) {
    if (matches.length >= MAX_MATCHES) break;
    if (matchesAccount(account, q)) {
      matches.push(toMatch(account));
    }
  }

  return NextResponse.json({ matches });
}
