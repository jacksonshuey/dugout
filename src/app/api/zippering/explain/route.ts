// GET /api/zippering/explain — explainability endpoint for the zippering engine.
//
// Returns the full decision history for a (pkey, canonical_name) pair so
// operators can see exactly what Haiku decided and why. Operator tooling:
// freshness > caching — no-store.
//
// Query params:
//   workspace  — workspace key (default: 'dugout-default')
//   pkey       — account primary key (required)
//   canonical  — canonical column name (required)
//
// Design: docs/zippering-plan.md §6, swarm-spec §5 L4A

import { NextResponse } from "next/server";
import { getDecisionHistory } from "@/lib/zippering";
import type { AccountId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspace_key = url.searchParams.get("workspace") ?? "dugout-default";
  const pkey = url.searchParams.get("pkey");
  const canonical = url.searchParams.get("canonical");

  if (!pkey || !canonical) {
    return NextResponse.json(
      { error: "pkey and canonical are required query params" },
      { status: 400 },
    );
  }

  try {
    const decisions = await getDecisionHistory(
      workspace_key,
      pkey as AccountId,
      canonical,
    );
    return NextResponse.json(
      { pkey, canonical, decisions },
      {
        headers: {
          "cache-control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to load decision history" },
      { status: 500 },
    );
  }
}
