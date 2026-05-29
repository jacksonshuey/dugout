import { NextResponse } from "next/server";
import { embedSignalsSweep } from "@/lib/embed-sweep";

// Daily embedding sweep: embeds recent external_signals that don't yet have
// vectors into doc_embeddings, powering semantic_search. Runs on its own cron
// (configured in vercel.json) so embedding stays OFF the inbound webhook and
// per-email chain hot paths. Idempotent — only embeds signals missing from the
// vector table.
//
// Triggered by Vercel cron. Auth mirrors the other cron routes: Vercel injects
// Authorization: Bearer ${CRON_SECRET}. Fails closed when the secret is unset
// so paid OpenAI embedding work is never exposed publicly.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // seconds — Vercel hobby cap

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authorized(req: Request): boolean {
  const required = process.env.CRON_SECRET;
  if (!required) return false;
  const header = req.headers.get("authorization") ?? "";
  return timingSafeEqual(header, `Bearer ${required}`);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await embedSignalsSweep();
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
