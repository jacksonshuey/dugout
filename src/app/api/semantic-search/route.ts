import { NextResponse } from "next/server";
import {
  semanticSearch,
  INTEL_SOURCE_TABLES,
  ONTOLOGY_SOURCE_TABLE,
} from "@/lib/semantic-search";

// Read-only semantic search over the ingested intel already shown publicly on
// the landing page (signals, news, filings, transcripts, emails). Powers the
// search boxes in the dashboard + ontology section. Embeds the query (OpenAI)
// and queries the pgvector tier; returns [] when the vector tier isn't
// populated yet, so the UI shows a clean empty state.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_QUERY_CHARS = 300;
const MAX_LIMIT = 12;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = (searchParams.get("q") ?? "").slice(0, MAX_QUERY_CHARS).trim();
  const account = searchParams.get("account") || null;
  const limitRaw = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, MAX_LIMIT)
      : 8;

  // scope=schema searches the embedded ontology (canonical fields); anything
  // else searches the ingested intel (and explicitly excludes the schema rows).
  const sourceTables =
    searchParams.get("scope") === "schema"
      ? [ONTOLOGY_SOURCE_TABLE]
      : INTEL_SOURCE_TABLES;

  if (!query) return NextResponse.json({ query: "", matches: [] });

  try {
    const matches = await semanticSearch(query, {
      accountId: account,
      limit,
      sourceTables,
    });
    return NextResponse.json(
      { query, matches },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ query, matches: [] });
  }
}
