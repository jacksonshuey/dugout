import { NextResponse } from "next/server";
import {
  searchExistingAccounts,
  searchExternalCompanies,
} from "@/lib/company-search";

// Company search for the /onboard page. Returns two parallel result sets:
//   - `existing`: matches against currently-tracked seed accounts
//   - `external`: matches from Clearbit Autocomplete (free public API)
//
// Both fail soft to empty arrays so a Clearbit outage doesn't break the
// search box — the existing-match results still render.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json(
      { existing: [], external: [] },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const [existing, external] = await Promise.all([
    searchExistingAccounts(q).catch(() => []),
    searchExternalCompanies(q).catch(() => []),
  ]);

  return NextResponse.json(
    { existing, external },
    { headers: { "cache-control": "no-store" } },
  );
}
