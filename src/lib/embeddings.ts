import { getOpenAIClient } from "./openai";

// Embedding layer for the semantic-retrieval tier. Turns text (signal
// summaries, transcripts, email bodies, scrapes) into vectors that
// doc_embeddings stores and match_documents searches.
//
// Null-safe by design, mirroring getOpenAIClient(): when no OPENAI_API_KEY is
// configured every call returns null, so embed-on-ingest hooks and the
// semantic_search tool degrade to no-ops instead of throwing. Semantic search
// simply returns nothing and the /ask agent falls back to its structured
// tools.

// text-embedding-3-small: 1536 dims, ~$0.02 / 1M tokens. The dimension is
// pinned in the doc_embeddings schema (vector(1536)) — changing the model
// means a migration + re-backfill, so it lives as a constant here.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

// Embedding inputs are capped well below the model's 8191-token limit. Signal
// summaries are short; source_content_md is truncated to this before
// embedding so a 40k-char filing doesn't blow the token budget. The lede
// carries most of the retrievable signal anyway.
const MAX_EMBED_CHARS = 8_000;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBED_CHARS);
}

// Embed a single string. Returns null when there's no key or no usable input.
export async function embed(text: string): Promise<number[] | null> {
  const client = getOpenAIClient();
  if (!client) return null;
  const input = clean(text);
  if (!input) return null;

  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  return res.data[0]?.embedding ?? null;
}

// Embed many strings in one request, preserving index alignment with the
// input array (empty inputs map to null). Returns all-null when there's no
// key. OpenAI accepts up to 2048 inputs per call; callers batch larger sets.
export async function embedBatch(
  texts: string[],
): Promise<(number[] | null)[]> {
  const client = getOpenAIClient();
  if (!client) return texts.map(() => null);

  const cleaned = texts.map(clean);
  // Track which inputs are non-empty so we only send those and can realign
  // the response back onto the original index space.
  const sendable: { idx: number; text: string }[] = [];
  cleaned.forEach((t, idx) => {
    if (t) sendable.push({ idx, text: t });
  });
  if (sendable.length === 0) return texts.map(() => null);

  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: sendable.map((s) => s.text),
  });

  const out: (number[] | null)[] = texts.map(() => null);
  res.data.forEach((d, i) => {
    const target = sendable[i];
    if (target) out[target.idx] = d.embedding;
  });
  return out;
}
