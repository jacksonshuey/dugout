import { supabaseAdmin } from "./supabase";

// Persistence for the per-email agent chain. See
// supabase/migrations/20260528_news_batches.sql for the schema and
// news-batch-pipeline.ts for the orchestration. This file is the DB boundary
// only. (The `news_batches` table name is historical — each row is now one
// agent run over a single email.)

// A single inbound email, trimmed to the columns the agent chain needs.
export interface ChainEmail {
  id: string;
  subject: string | null;
  text_body: string | null;
  publisher_canonical_name: string | null;
  from_domain: string;
}

// One agent's recorded action within a run — the unit the "watch the agent
// work" visual steps through.
export interface AgentStep {
  agent: "summarize" | "gate" | "categorize" | "append";
  label: string;
  status: "ok" | "skipped" | "error";
  started_at: string;
  duration_ms: number;
  input_preview: string;
  output_preview: string;
}

// One row of the display dataset (and audit record) the chain produces — one
// per email. email_ids/email_subjects/news_sources are single-element arrays
// (the schema keeps them as arrays for forward-compatibility).
export interface AgentRunRecord {
  email_ids: string[];
  email_subjects: string[];
  news_sources: string[];
  batch_summary: string;
  is_news: boolean;
  gate_reasoning: string | null;
  category: string | null;
  signal_id: string | null;
  status: "appended" | "rejected" | "error";
  steps: AgentStep[];
}

export async function insertAgentRun(rec: AgentRunRecord): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("news_batches").insert(rec);
  if (error) throw new Error(`insertAgentRun failed: ${error.message}`);
}

// A finished run shaped for the "watch the agent work" visual.
export interface AgentTrace {
  id: string;
  createdAt: string;
  emailSubjects: string[];
  newsSources: string[];
  summary: string;
  isNews: boolean;
  gateReasoning: string | null;
  category: string | null;
  status: "appended" | "rejected" | "error";
  steps: AgentStep[];
}

// Most recent runs, newest first, for the agent-trace visual. Fails soft to []
// so a missing table (migration not yet applied) or Supabase outage never
// breaks the page — the UI falls back to its sample trace.
export async function getLatestAgentTraces(limit = 1): Promise<AgentTrace[]> {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return [];
  }
  try {
    const { data, error } = await sb
      .from("news_batches")
      .select(
        "id, created_at, email_subjects, news_sources, batch_summary, is_news, gate_reasoning, category, status, steps",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      emailSubjects: (r.email_subjects ?? []) as string[],
      newsSources: (r.news_sources ?? []) as string[],
      summary: (r.batch_summary ?? "") as string,
      isNews: !!r.is_news,
      gateReasoning: (r.gate_reasoning ?? null) as string | null,
      category: (r.category ?? null) as string | null,
      status: r.status as AgentTrace["status"],
      steps: (r.steps ?? []) as AgentStep[],
    }));
  } catch {
    return [];
  }
}
