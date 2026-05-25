// /zippering/explain — decision history table for a (pkey, canonical_name) pair.
//
// Server-rendered. Calls getDecisionHistory() from the L3A engine directly
// (no HTTP self-fetch — server components prefer lib helpers per project
// conventions). Shows verdict chips, needs_review flags, and sample values
// so operators can audit exactly what Haiku decided and why.
//
// Query params:
//   workspace  — workspace key (default: 'dugout-default')
//   pkey       — account primary key (required for data; empty state when missing)
//   canonical  — canonical column name (required for data; empty state when missing)
//
// Next 16: searchParams is a Promise — must be awaited before reading.
//
// Design: docs/zippering-plan.md §6, swarm-spec §5 L4A, handoff §3.7

import { Card } from "@/components/ui";
import { getDecisionHistory } from "@/lib/zippering";
import type { ZipperingDecisionRow, ZipperingVerdict } from "@/lib/zippering-types";
import type { AccountId } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    workspace?: string;
    pkey?: string;
    canonical?: string;
  }>;
}

export default async function ZipperingExplainPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const workspace = params.workspace ?? "dugout-default";
  const pkey = params.pkey;
  const canonical = params.canonical;

  // Empty state — no params provided yet.
  if (!pkey || !canonical) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
          Zippering
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Explain a decision</h1>
        <p className="mt-3 text-sm text-muted max-w-xl">
          Pass{" "}
          <code className="text-xs bg-black/[0.04] px-1 py-0.5 rounded">
            ?pkey=acc_xxx&amp;canonical=column_name
          </code>{" "}
          to see the full routing decision history for a (account, canonical column) pair.
          Optionally add{" "}
          <code className="text-xs bg-black/[0.04] px-1 py-0.5 rounded">
            &amp;workspace=dugout-default
          </code>{" "}
          to scope to a specific workspace.
        </p>
        <p className="mt-4 text-sm text-muted">
          Each entry shows what Haiku decided, the similarity score, and the reason —
          so anyone can see exactly how a column got routed.
        </p>
      </div>
    );
  }

  let decisions: ZipperingDecisionRow[] = [];
  let fetchError: string | null = null;

  try {
    decisions = await getDecisionHistory(workspace, pkey as AccountId, canonical);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="space-y-1 mb-6">
        <div className="text-xs uppercase tracking-wider text-muted font-medium">
          Zippering · decision history
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <code className="text-xl">{canonical}</code>
          <span className="text-muted text-base font-normal ml-2">on {pkey}</span>
        </h1>
        <p className="text-sm text-muted max-w-2xl">
          Full Haiku + operator decision log for this canonical column.
          Latest entry (top row) is the active routing.
          Workspace:{" "}
          <code className="text-xs bg-black/[0.04] px-1 py-0.5 rounded">{workspace}</code>
        </p>
      </div>

      {/* Error state */}
      {fetchError && (
        <Card className="p-6 text-sm space-y-2">
          <div className="font-medium">Failed to load decision history</div>
          <div className="text-muted font-mono text-xs break-all">{fetchError}</div>
        </Card>
      )}

      {/* Decision table */}
      {!fetchError && (
        <Card className="overflow-x-auto">
          <table
            className="w-full text-sm"
            aria-label={`Decision history for ${canonical} on ${pkey}`}
          >
            <thead className="bg-black/[0.02] text-left text-[11px] uppercase tracking-[0.08em] text-muted font-medium border-b border-border">
              <tr>
                <th className="px-4 py-2" scope="col">Decided at</th>
                <th className="px-4 py-2" scope="col">By</th>
                <th className="px-4 py-2" scope="col">Source · column</th>
                <th className="px-4 py-2" scope="col">Verdict</th>
                <th className="px-4 py-2" scope="col">Score</th>
                <th className="px-4 py-2" scope="col">Reason</th>
                <th className="px-4 py-2" scope="col">Samples</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-border align-top hover:bg-black/[0.02]"
                >
                  {/* decided_at */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted">
                    <time dateTime={d.decided_at}>
                      {new Date(d.decided_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </td>

                  {/* decided_by */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                    {d.decided_by}
                  </td>

                  {/* source · source_column */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <code className="text-xs">
                      {d.source}
                      <span className="text-muted">·</span>
                      {d.source_column}
                    </code>
                  </td>

                  {/* verdict chip + needs_review flag */}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <VerdictChip verdict={d.verdict} />
                      {d.needs_review && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider border border-amber-400/40 bg-amber-400/10 text-amber-700"
                          aria-label="Needs review"
                          title="This decision is flagged for operator review"
                        >
                          review
                        </span>
                      )}
                    </div>
                  </td>

                  {/* similarity_score */}
                  <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                    {d.similarity_score !== null && d.similarity_score !== undefined
                      ? d.similarity_score.toFixed(2)
                      : <span className="text-muted">—</span>}
                  </td>

                  {/* reason */}
                  <td className="px-4 py-3 max-w-xs text-muted text-xs leading-snug">
                    {d.reason ?? <span className="text-muted">—</span>}
                  </td>

                  {/* source_samples */}
                  <td className="px-4 py-3 font-mono text-xs text-muted max-w-[160px] truncate">
                    {d.source_samples && d.source_samples.length > 0
                      ? JSON.stringify(d.source_samples)
                      : <span>—</span>}
                  </td>
                </tr>
              ))}

              {/* Empty data state */}
              {decisions.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-muted"
                  >
                    No decisions found for{" "}
                    <code className="text-xs">{canonical}</code> on{" "}
                    <code className="text-xs">{pkey}</code>. Call{" "}
                    <code className="text-xs">zipperUpsert()</code> with a row
                    containing this column to generate the first decision.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {/* Row count */}
      {!fetchError && decisions.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {decisions.length} decision{decisions.length !== 1 ? "s" : ""} — newest first.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VerdictChip — color-coded by verdict type
// ---------------------------------------------------------------------------

const VERDICT_STYLES: Record<ZipperingVerdict, string> = {
  join: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  append: "border-sky-500/30 bg-sky-500/10 text-sky-700",
  unclear: "border-amber-500/30 bg-amber-500/10 text-amber-700",
};

function VerdictChip({ verdict }: { verdict: ZipperingVerdict }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider uppercase border ${VERDICT_STYLES[verdict]}`}
      aria-label={`Verdict: ${verdict}`}
    >
      {verdict}
    </span>
  );
}
