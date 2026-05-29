import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// GET /api/inbox/recall?q=<query>&limit=<n>
//
// Full-text search across every newsletter body Dugout has ever received.
// Backed by the inbound_emails.body_tsv generated tsvector column + GIN
// index added in migration 20260529_inbox_remedy.sql. Returns matching
// emails with a snippet for the inbox search bar.
//
// Open route (no UI session gate) since the inbox itself is open. The
// returned snippet is bounded so a malicious query can't dump entire
// newsletter bodies; full body inspection still goes through the gated
// /api/admin/inbound-email/[id] route.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SNIPPET_LEN = 240;
const MAX_QUERY_LEN = 200;

interface RecallHit {
  id: string;
  subject: string | null;
  publisher: string | null;
  received_at: string;
  snippet: string;
}

// Build a websearch-style tsquery the user can't break. We use
// `websearch_to_tsquery` (Postgres 11+) via a string passed through the SDK
// param so common quoting "foo bar" / OR / -term all work without us
// hand-rolling the syntax. Length-capped to prevent abuse.
function sanitizeQuery(raw: string): string {
  return raw.trim().slice(0, MAX_QUERY_LEN);
}

function buildSnippet(body: string | null, q: string): string {
  if (!body) return "";
  const lower = body.toLowerCase();
  const needle = q.toLowerCase().split(/\s+/).find(Boolean) ?? "";
  let start = 0;
  if (needle && lower.includes(needle)) {
    const idx = lower.indexOf(needle);
    start = Math.max(0, idx - 60);
  }
  let snippet = body.slice(start, start + SNIPPET_LEN);
  if (start > 0) snippet = "…" + snippet;
  if (start + SNIPPET_LEN < body.length) snippet = snippet + "…";
  return snippet.replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawQ = url.searchParams.get("q") ?? "";
  const q = sanitizeQuery(rawQ);
  if (!q) {
    return NextResponse.json({ q: "", hits: [] satisfies RecallHit[] });
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)),
  );

  try {
    const sb = supabaseAdmin();
    // `textSearch` defaults to `tsquery`; we pass the websearch config so the
    // operator can type natural language. The matching column is the STORED
    // tsvector (body_tsv) — Postgres uses the GIN index automatically.
    const { data, error } = await sb
      .from("inbound_emails")
      .select(
        "id, subject, received_at, publisher_canonical_name, from_domain, body_markdown",
      )
      .textSearch("body_tsv", q, { type: "websearch", config: "english" })
      .order("received_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: `recall failed: ${error.message}` },
        { status: 500 },
      );
    }

    const hits: RecallHit[] = (data ?? []).map((row) => ({
      id: row.id,
      subject: row.subject,
      publisher: row.publisher_canonical_name ?? row.from_domain ?? null,
      received_at: row.received_at,
      snippet: buildSnippet(row.body_markdown, q),
    }));

    return NextResponse.json({ q, hits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
