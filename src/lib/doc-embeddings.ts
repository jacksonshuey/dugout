import { supabaseAdmin } from "./supabase";

// DB boundary for the vector retrieval tier. See
// supabase/migrations/20260528_doc_embeddings.sql for the schema + the
// match_documents RPC. Embedding generation lives in embeddings.ts; this file
// only reads/writes the doc_embeddings table.

export type DocSourceTable =
  | "external_signals"
  | "inbound_emails"
  | "granola_transcripts"
  | "web_scrapes";

export interface DocEmbeddingInput {
  source_table: DocSourceTable;
  source_id: string;
  account_id: string | null;
  kind: string | null;
  content: string;
  embedding: number[];
}

// A semantic-search hit returned by match_documents, ordered by similarity
// (1.0 = identical). `content` is the exact embedded text, so the retrieval
// agent can quote it with full source attribution.
export interface MatchedDoc {
  id: string;
  sourceTable: string;
  sourceId: string;
  accountId: string | null;
  kind: string | null;
  content: string;
  similarity: number;
}

// Upsert one embedding, keyed on (source_table, source_id) so re-embedding a
// row replaces rather than duplicates. Used by embed-on-ingest hooks and the
// backfill script.
export async function upsertEmbedding(doc: DocEmbeddingInput): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("doc_embeddings")
    .upsert(doc, { onConflict: "source_table,source_id" });
  if (error) throw new Error(`upsertEmbedding failed: ${error.message}`);
}

// Bulk variant for the backfill path.
export async function upsertEmbeddings(
  docs: DocEmbeddingInput[],
): Promise<void> {
  if (docs.length === 0) return;
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("doc_embeddings")
    .upsert(docs, { onConflict: "source_table,source_id" });
  if (error) throw new Error(`upsertEmbeddings failed: ${error.message}`);
}

// Cosine-similarity search via the match_documents RPC. Optionally scoped to
// one account. Returns [] on any error (missing extension/table pre-migration,
// Supabase outage) so the retrieval agent degrades to its structured tools
// instead of failing the turn.
export async function matchDocuments(
  queryEmbedding: number[],
  opts: { matchCount?: number; accountId?: string | null } = {},
): Promise<MatchedDoc[]> {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return [];
  }
  try {
    const { data, error } = await sb.rpc("match_documents", {
      query_embedding: queryEmbedding,
      match_count: opts.matchCount ?? 8,
      filter_account: opts.accountId ?? null,
    });
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      sourceTable: r.source_table as string,
      sourceId: r.source_id as string,
      accountId: (r.account_id ?? null) as string | null,
      kind: (r.kind ?? null) as string | null,
      content: (r.content ?? "") as string,
      similarity: Number(r.similarity ?? 0),
    }));
  } catch {
    return [];
  }
}
