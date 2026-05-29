import { embed } from "./embeddings";
import { matchDocuments } from "./doc-embeddings";

// Meaning-based retrieval over everything ingested into the vector tier
// (signals, transcripts, emails, scrapes). Embeds the query, then asks the
// match_documents RPC for the closest chunks by cosine similarity.
//
// Null-safe end to end: no OpenAI key → embed() returns null → []; missing
// table/extension → matchDocuments() returns []. So the /ask agent's
// semantic_search tool degrades to "no matches" and the agent falls back to
// its structured tools, rather than failing the turn.

// A single search hit. Shaped to be citable by the /ask agent: it carries the
// {id, sourceTool, summary} triple collectCitations() looks for, plus the full
// chunk `content` (for the model to read) and provenance.
export interface SemanticHit {
  id: string;
  sourceTool: "semantic_search";
  summary: string; // short preview, used for the citation payload
  content: string; // the full matched chunk, for the model
  sourceTable: string;
  sourceId: string;
  accountId: string | null;
  kind: string | null;
  similarity: number;
}

function preview(s: string, n = 200): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export async function semanticSearch(
  query: string,
  opts: { accountId?: string | null; limit?: number } = {},
): Promise<SemanticHit[]> {
  const q = query.trim();
  if (!q) return [];

  const vector = await embed(q);
  if (!vector) return [];

  const docs = await matchDocuments(vector, {
    matchCount: opts.limit ?? 8,
    accountId: opts.accountId ?? null,
  });

  return docs.map((d) => ({
    id: d.id,
    sourceTool: "semantic_search" as const,
    summary: preview(d.content),
    content: d.content,
    sourceTable: d.sourceTable,
    sourceId: d.sourceId,
    accountId: d.accountId,
    kind: d.kind,
    similarity: d.similarity,
  }));
}
