import { NextResponse } from "next/server";
import { runClassifyPendingSweep } from "@/lib/classify-pending-sweep";

// Daily Vercel-cron sweep of the classify-pending queues. Implementation
// (and the same code path used by the admin manual trigger) lives in
// src/lib/classify-pending-sweep.ts so observability + behavior stay
// identical across the two entry points.
//
// Auth: CRON_SECRET (Vercel injects "Authorization: Bearer ${CRON_SECRET}").
// Fail-closed when the env var is missing.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  return req.headers.get("authorization") === `Bearer ${required}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runClassifyPendingSweep();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
