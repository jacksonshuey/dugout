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

// Embedding inputs are capped well below the model's 8191-token limit. Callers
// chunk long artifacts first (see chunkText); this cap is a final safety net
// per chunk.
const MAX_EMBED_CHARS = 8_000;

// Chunking targets. ~3000 chars ≈ ~750 tokens — small enough that a match
// points at a focused passage, large enough to keep context. Overlap carries a
// little context across boundaries so a fact split mid-chunk is still
// retrievable from both sides.
const CHUNK_CHARS = 3_000;
const CHUNK_OVERLAP = 250;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_EMBED_CHARS);
}

// Strip HTML to readable text before embedding/display. A lot of inbound
// `source_content_md` is raw email HTML (tables, inline styles); embedding the
// markup adds noise and renders as `<td style…>` garbage in search results.
// Markdown/plain text passes through largely untouched (paragraph breaks kept).
export function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split a document into overlapping chunks for embedding. Prefers to break at a
// paragraph/sentence boundary near the target size so chunks read as coherent
// passages rather than mid-word cuts. Short inputs return a single chunk;
// empty/blank input returns []. Dependency-free.
export function chunkText(
  text: string,
  opts: { size?: number; overlap?: number } = {},
): string[] {
  const size = opts.size ?? CHUNK_CHARS;
  const overlap = opts.overlap ?? CHUNK_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= size) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      // Look backwards from the hard cut for a clean boundary (paragraph >
      // sentence > space) within the last ~30% of the window.
      const window = normalized.slice(start, end);
      const floor = Math.floor(size * 0.7);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
      );
      const space = window.lastIndexOf(" ");
      const cut = [para, sentence, space].find((i) => i >= floor);
      if (cut !== undefined && cut > 0) end = start + cut + 1;
    }
    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= normalized.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
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
