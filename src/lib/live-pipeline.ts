// Live pipeline snapshot: what the inbound → filter → signal pipeline is
// actually doing right now. Drives the "under the hood" visual on the
// landing page so visitors see real data flowing, not a mockup.
//
// One round-trip-friendly snapshot covers:
//   - 24h counters (inbound count, signals emitted, dropped, last activity)
//   - Most recent CLASSIFIED email with its full chain:
//       email → filter decision (reasoning + model) → resulting signal (or null)
//
// Reads from three tables:
//   - inbound_emails       (every email AgentMail delivered)
//   - email_filter_decisions (every Haiku verdict + reasoning)
//   - external_signals     (every signal that landed in the dashboard)
//
// All reads fail soft. A Supabase outage returns null and the UI falls
// back to the static visual. Called from page.tsx during ISR revalidation
// (60s), not on the user-interaction hot path.

import { supabaseAdmin } from "./supabase";

export interface LivePipelineCounts {
  inbound24h: number;
  signals24h: number;
  dropped24h: number;
  lastActivityAt: string | null;
}

export interface LivePipelineEmail {
  id: string;
  from_address: string;
  from_domain: string;
  subject: string | null;
  received_at: string;
  body_preview: string; // first ~280 chars of text_body
  publisher_canonical_name: string | null;
}

export interface LivePipelineDecision {
  verdict: string; // stage1_rejected / newsworthy / promotional / logistics / other
  stage: 1 | 2;
  confidence: number | null;
  reasoning: string;
  model: string | null;
  decided_at: string;
}

export interface LivePipelineSignal {
  summary: string;
  account_id: string;
  workspace_relevance: string | null;
  publisher_canonical_name: string | null;
}

export interface LivePipelineRun {
  email: LivePipelineEmail;
  filterDecision: LivePipelineDecision | null;
  resultSignal: LivePipelineSignal | null;
}

export interface LivePipelineSnapshot {
  counts: LivePipelineCounts;
  latestRun: LivePipelineRun | null;
}

const BODY_PREVIEW_CHARS = 280;

export async function getLivePipelineSnapshot(): Promise<LivePipelineSnapshot | null> {
  let sb;
  try {
    sb = supabaseAdmin();
  } catch {
    return null;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Parallel: 4 counts + the most compelling latest run. We prefer an
    // email that produced an actual signal (the full chain renders) but
    // fall back to any classified email if no signals exist in the window.
    const [
      inboundCount,
      signalsCount,
      droppedCount,
      lastReceived,
      latestSignalEmail,
      latestClassifiedEmail,
    ] = await Promise.all([
      sb
        .from("inbound_emails")
        .select("id", { count: "exact", head: true })
        .gte("received_at", since),
      sb
        .from("external_signals")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      // Drops = stage1 rejected OR stage2 non-newsworthy. Run as separate
      // counts then sum, since Supabase's .or() with .and() child clauses
      // gets brittle. Cheaper to do two head-only counts.
      countDropped(sb, since),
      sb
        .from("inbound_emails")
        .select("received_at")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Most recent email that produced a real signal (preferred — full
      // chain renders end-to-end).
      sb
        .from("external_signals")
        .select("inbound_email_id, created_at")
        .not("inbound_email_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Fallback: most recent classified email regardless of outcome.
      sb
        .from("inbound_emails")
        .select(
          "id, from_address, from_domain, subject, received_at, text_body, publisher_canonical_name",
        )
        .not("classified_at", "is", null)
        .order("classified_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // If we found a signal-linked email, fetch its full row. Otherwise
    // fall back to the most-recent-classified row.
    let latestEmailRow = latestClassifiedEmail;
    const signalLinkedId = (
      latestSignalEmail.data as { inbound_email_id?: string } | null
    )?.inbound_email_id;
    if (signalLinkedId) {
      const { data: signalEmail } = await sb
        .from("inbound_emails")
        .select(
          "id, from_address, from_domain, subject, received_at, text_body, publisher_canonical_name",
        )
        .eq("id", signalLinkedId)
        .maybeSingle();
      if (signalEmail) {
        latestEmailRow = { data: signalEmail, error: null } as typeof latestClassifiedEmail;
      }
    }

    const counts: LivePipelineCounts = {
      inbound24h: inboundCount.count ?? 0,
      signals24h: signalsCount.count ?? 0,
      dropped24h: droppedCount,
      lastActivityAt:
        (lastReceived.data as { received_at?: string } | null)?.received_at ?? null,
    };

    const emailRow = latestEmailRow.data as
      | {
          id: string;
          from_address: string;
          from_domain: string;
          subject: string | null;
          received_at: string;
          text_body: string | null;
          publisher_canonical_name: string | null;
        }
      | null;

    if (!emailRow) {
      return { counts, latestRun: null };
    }

    // Filter decision + signal for the chosen email, in parallel.
    const [decisionRow, signalRow] = await Promise.all([
      sb
        .from("email_filter_decisions")
        .select("verdict, stage, confidence, reasoning, model, decided_at")
        .eq("inbound_email_id", emailRow.id)
        .order("decided_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("external_signals")
        .select(
          "summary, account_id, workspace_relevance, publisher_canonical_name",
        )
        .eq("inbound_email_id", emailRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const decision = decisionRow.data as {
      verdict: string;
      stage: number;
      confidence: number | null;
      reasoning: string;
      model: string | null;
      decided_at: string;
    } | null;

    const signal = signalRow.data as {
      summary: string;
      account_id: string;
      workspace_relevance: string | null;
      publisher_canonical_name: string | null;
    } | null;

    return {
      counts,
      latestRun: {
        email: {
          id: emailRow.id,
          from_address: emailRow.from_address,
          from_domain: emailRow.from_domain,
          subject: emailRow.subject,
          received_at: emailRow.received_at,
          body_preview: (emailRow.text_body ?? "")
            .trim()
            .slice(0, BODY_PREVIEW_CHARS),
          publisher_canonical_name: emailRow.publisher_canonical_name,
        },
        filterDecision: decision
          ? {
              verdict: decision.verdict,
              stage: (decision.stage === 1 ? 1 : 2) as 1 | 2,
              confidence: decision.confidence,
              reasoning: decision.reasoning,
              model: decision.model,
              decided_at: decision.decided_at,
            }
          : null,
        resultSignal: signal ?? null,
      },
    };
  } catch (e) {
    console.warn(
      `[live-pipeline] snapshot failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

// Drops in the last 24h = stage1 rejects + stage2 non-newsworthy verdicts.
// Returned as a single integer for the counters strip.
async function countDropped(
  sb: ReturnType<typeof supabaseAdmin>,
  since: string,
): Promise<number> {
  const [stage1, stage2] = await Promise.all([
    sb
      .from("email_filter_decisions")
      .select("id", { count: "exact", head: true })
      .eq("verdict", "stage1_rejected")
      .gte("decided_at", since),
    sb
      .from("email_filter_decisions")
      .select("id", { count: "exact", head: true })
      .eq("stage", 2)
      .in("verdict", ["promotional", "logistics", "other"])
      .gte("decided_at", since),
  ]);
  return (stage1.count ?? 0) + (stage2.count ?? 0);
}
