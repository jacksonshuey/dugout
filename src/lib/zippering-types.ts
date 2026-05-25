import type { AccountId } from "./types";

export type ZipperingDataType =
  | "text" | "integer" | "numeric" | "boolean"
  | "timestamp" | "jsonb" | "string[]";

export type ZipperingVerdict = "join" | "append" | "unclear";

export interface GlobalCanonicalColumn {
  id: string;
  workspace_key: string;
  name: string;
  data_type: ZipperingDataType;
  description: string | null;
  semantic_tags: string[];
  created_at: string;
}

export interface ZipperingSchemaRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  canonical_name: string;
  data_type: ZipperingDataType;
  description: string | null;
  is_global: boolean;
  source_origin: string | null;
  first_seen_at: string;
  updated_at: string;
}

export interface ZipperingDecisionRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  source: string;
  source_column: string;
  source_data_type: string | null;
  source_description: string | null;
  source_samples: unknown[] | null;
  verdict: ZipperingVerdict;
  canonical_name: string;
  is_global_target: boolean;
  similarity_score: number | null;
  reason: string | null;
  needs_review: boolean;
  decided_by: string;          // 'haiku' | 'normalizer' | rep_id
  decided_at: string;
}

export interface ZipperedSignalRow {
  id: string;
  workspace_key: string;
  pkey: AccountId;
  source: string;
  external_id: string | null;
  occurred_at: string;
  columns: Record<string, unknown>;
  ingested_at: string;
}

// Input to zipperUpsert(): one incoming integration row.
export interface IngestRow {
  workspace_key?: string;       // defaults to 'dugout-default'
  pkey: AccountId;
  source: string;               // 'granola' | 'sec_edgar' | ...
  external_id?: string;
  occurred_at: string;          // every signal must have a time
  columns: Record<string, IngestValue>;
}

export interface IngestValue {
  value: unknown;
  source_data_type: ZipperingDataType;
  source_description?: string;
}

// Haiku's return shape (enforced via tool_choice + strict schema).
export interface HaikuRoutingVerdict {
  verdict: ZipperingVerdict;
  canonical_name: string;
  is_global_target: boolean;
  similarity_score: number;
  reason: string;
}
