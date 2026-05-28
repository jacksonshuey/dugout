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
  account_id    text,
  kind          text,
  content       text          not null,
  embedding     vector(1536)  not null,
  created_at    timestamptz   not null default now(),
  -- One embedding per source row. Lets ingest + backfill upsert idempotently
  -- (on conflict) instead of duplicating when a row is re-embedded.
  unique (source_table, source_id)
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
create or replace function match_documents(
  query_embedding vector(1536),
  match_count     int  default 8,
  filter_account  text default null
)
returns table (
  id           uuid,
  source_table text,
  source_id    text,
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
    d.account_id,
    d.kind,
    d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from doc_embeddings d
  where filter_account is null or d.account_id = filter_account
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
