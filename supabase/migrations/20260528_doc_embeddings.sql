-- Vector retrieval tier — the semantic-search layer over everything Dugout
-- already stores. Adds the third storage pattern alongside the relational
-- canonical objects (external_signals, accounts, …) and the text artifacts
-- kept in source_content_md: a pgvector index the retrieval agent searches by
-- meaning rather than exact keyword.
--
-- One polymorphic table holds every embedded document — signals, transcripts,
-- emails, scrapes — so there's a single index and a single search path. Each
-- row points back to its origin via (source_table, source_id) and carries the
-- account_id for scoped retrieval. `content` is the exact text that was
-- embedded, so a match can be shown verbatim with full attribution.
--
-- Long artifacts (a 40k-char filing, a full transcript) are split into chunks
-- before embedding — one vector per chunk — because a single embedding over a
-- truncated whole document loses most of the retrievable signal. chunk_index
-- orders the chunks within a source; (source_table, source_id, chunk_index) is
-- unique so ingest + backfill upsert idempotently instead of duplicating.
--
-- Embeddings are OpenAI text-embedding-3-small → 1536 dims (see
-- src/lib/embeddings.ts). Written on ingest and via scripts/backfill-embeddings.ts.
--
-- Run manually in Supabase Studio (Database → SQL Editor → New query). Same
-- posture as the other migrations — no runner is wired up.

create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists doc_embeddings (
  id            uuid          primary key default gen_random_uuid(),
  source_table  text          not null,
  source_id     text          not null,
  chunk_index   int           not null default 0,
  account_id    text,
  kind          text,
  content       text          not null,
  embedding     vector(1536)  not null,
  created_at    timestamptz   not null default now(),
  -- One embedding per (source row, chunk). Lets ingest + backfill upsert
  -- idempotently instead of duplicating when a source is re-embedded.
  unique (source_table, source_id, chunk_index)
);

-- Approximate-nearest-neighbour index for cosine similarity. HNSW gives better
-- recall/latency than ivfflat at this scale and needs no training step.
create index if not exists doc_embeddings_hnsw
  on doc_embeddings using hnsw (embedding vector_cosine_ops);

-- Account-scoped retrieval ("everything we know about Moderna") filters here.
create index if not exists doc_embeddings_account_idx
  on doc_embeddings (account_id);

-- Semantic search entry point. Vector ops can't be expressed through the
-- supabase-js query builder, so the retrieval agent calls this RPC. Returns
-- the closest `match_count` documents by cosine similarity, optionally scoped
-- to one account. similarity = 1 - cosine_distance (1.0 = identical).
--
-- query_embedding is typed `text` (not vector) on purpose: supabase-js /
-- PostgREST does not reliably coerce a JSON number array into a pgvector
-- param. The client passes JSON.stringify(embedding) — e.g. '[0.01,...]' —
-- and we cast it here, which pgvector accepts unambiguously.
create or replace function match_documents(
  query_embedding      text,
  match_count          int    default 8,
  filter_account       text   default null,
  filter_source_tables text[] default null
)
returns table (
  id           uuid,
  source_table text,
  source_id    text,
  chunk_index  int,
  account_id   text,
  kind         text,
  content      text,
  similarity   float
)
language sql stable
as $$
  select
    d.id,
    d.source_table,
    d.source_id,
    d.chunk_index,
    d.account_id,
    d.kind,
    d.content,
    1 - (d.embedding <=> query_embedding::vector(1536)) as similarity
  from doc_embeddings d
  -- Account: no filter → any account. Scoped to an account → that account PLUS
  -- workspace-wide intel ('__workspace__'), since market-wide news is relevant
  -- to any account question.
  where (filter_account is null
         or d.account_id = filter_account
         or d.account_id = '__workspace__')
  -- Source tables: no filter → all. Otherwise restrict to the given set
  -- (intel search excludes the 'ontology_field' schema index; schema search
  -- restricts TO it).
    and (filter_source_tables is null
         or d.source_table = any(filter_source_tables))
  order by d.embedding <=> query_embedding::vector(1536)
  limit match_count;
$$;
