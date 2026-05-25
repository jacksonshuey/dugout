"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import type {
  Account,
  Opportunity,
  Rep,
  TrialIntake,
  TrialIntakeStatus,
} from "@/lib/types";
import {
  computeSla,
  deriveStatus,
  formatRemaining,
  loadIntakes,
} from "@/lib/trial-intake";
import { buildWorkspaceKey, mergeIntakes } from "./shared";

interface Props {
  seedIntakes: TrialIntake[];
  opportunities: Opportunity[];
  accounts: Account[];
  reps: Rep[];
  workspaceCompanyName: string;
  workspacePresetName: string | undefined;
}

// SLA countdowns need to tick - useState + setInterval keeps the bucket color
// and remaining-time string fresh without doing a full server roundtrip.
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TrialIntakeListView({
  seedIntakes,
  opportunities,
  accounts,
  reps,
  workspaceCompanyName,
  workspacePresetName,
}: Props) {
  const workspaceKey = useMemo(
    () => buildWorkspaceKey(workspacePresetName, workspaceCompanyName),
    [workspacePresetName, workspaceCompanyName],
  );

  const [storedIntakes, setStoredIntakes] = useState<TrialIntake[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // localStorage is client-only; this is the canonical rehydrate pattern
    // used by the Console for its task layer. Migrate to a derive-in-render
    // approach when intake storage moves off localStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredIntakes(loadIntakes(workspaceKey));
    setHydrated(true);
  }, [workspaceKey]);

  const intakes = useMemo(
    () => mergeIntakes(seedIntakes, storedIntakes),
    [seedIntakes, storedIntakes],
  );

  const now = useNow();

  const oppById = useMemo(
    () => new Map(opportunities.map((o) => [o.id, o])),
    [opportunities],
  );
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const repById = useMemo(() => new Map(reps.map((r) => [r.id, r])), [reps]);

  // Counts for the eyebrow row. Stable buckets - overdue is derived so the
  // ribbon refreshes alongside the timers.
  const counts = useMemo(() => {
    const out: Record<TrialIntakeStatus, number> = {
      pending_se_assignment: 0,
      in_progress: 0,
      delivered: 0,
      overdue: 0,
    };
    for (const i of intakes) out[deriveStatus(i, now)]++;
    return out;
  }, [intakes, now]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Trial Orchestrator
        </div>
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Active trial intakes
            </h1>
            <p className="text-sm text-muted mt-1 max-w-2xl">
              48-hour SLA from AE submission to KPI Assessment + pre-seeded demo
              delivered into the deal room. Companion to the signal engine -
              every submitted intake also resolves the linked Demo Sat
              trial-brief task on the AE Console.
            </p>
          </div>
          <Link href="/trial-intake/new">
            <Button>+ New intake</Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Pending SE" value={counts.pending_se_assignment} />
        <StatTile label="In progress" value={counts.in_progress} />
        <StatTile label="Delivered" value={counts.delivered} tone="green" />
        <StatTile label="Overdue" value={counts.overdue} tone="blocking" />
      </div>

      <div className="rounded-2xl border border-border bg-background overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-left px-4 py-3 font-medium">AE</th>
              <th className="text-left px-4 py-3 font-medium">Stage</th>
              <th className="text-left px-4 py-3 font-medium">Submitted</th>
              <th className="text-left px-4 py-3 font-medium">SLA remaining</th>
              <th className="text-left px-4 py-3 font-medium">SE assigned</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {!hydrated && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-xs text-muted"
                >
                  Loading…
                </td>
              </tr>
            )}
            {hydrated && intakes.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-muted"
                >
                  No active intakes.{" "}
                  <Link
                    href="/trial-intake/new"
                    className="text-brand hover:underline"
                  >
                    Submit one →
                  </Link>
                </td>
              </tr>
            )}
            {hydrated &&
              intakes.map((intake) => {
                const opp = oppById.get(intake.oppId);
                const account = accountById.get(intake.accountId);
                const ae = repById.get(intake.submittedBy);
                const se = intake.assignedSeId
                  ? repById.get(intake.assignedSeId)
                  : undefined;
                const status = deriveStatus(intake, now);
                const sla = computeSla(intake, now);
                return (
                  <tr
                    key={intake.id}
                    className="border-t border-border hover:bg-slate-50/50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/trial-intake/${intake.id}`}
                        className="block"
                      >
                        <div className="font-medium">
                          {account?.name ?? intake.accountId}
                        </div>
                        <div className="text-[11px] text-muted">
                          {opp?.name ?? intake.oppId}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {ae?.name ?? intake.submittedBy}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {opp?.stage ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {formatShortDateTime(intake.submittedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <SlaPill
                        bucket={sla.bucket}
                        label={formatRemaining(sla.remainingMs)}
                        deliveredFlag={status === "delivered"}
                      />
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {se ? se.name : (
                        <span className="text-severity-action">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted leading-relaxed">
        <span className="font-semibold text-foreground">Where this lives:</span>{" "}
        intakes persist to <code className="font-mono">localStorage</code> on
        this browser. Production swaps to a Postgres table with a real
        overdue-watchdog cron - the state machine on{" "}
        <code className="font-mono">TrialIntake</code> survives that migration
        unchanged.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces - kept local to this view so the file reads top-to-bottom.
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blocking" | "green";
}) {
  const valueCls =
    tone === "blocking"
      ? "text-severity-blocking"
      : tone === "green"
        ? "text-severity-green"
        : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted font-medium font-mono">
        {label}
      </div>
      <div className={`text-2xl font-semibold tracking-tight mt-1 ${valueCls}`}>
        {value}
      </div>
    </div>
  );
}

const BUCKET_STYLES: Record<
  "healthy" | "warning" | "urgent" | "overdue",
  string
> = {
  healthy: "bg-severity-green-bg text-severity-green border-severity-green/20",
  warning:
    "bg-severity-action-bg text-severity-action border-severity-action/20",
  urgent:
    "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20",
  overdue:
    "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20",
};

function SlaPill({
  bucket,
  label,
  deliveredFlag,
}: {
  bucket: "healthy" | "warning" | "urgent" | "overdue";
  label: string;
  deliveredFlag: boolean;
}) {
  if (deliveredFlag) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono border bg-severity-green-bg text-severity-green border-severity-green/20">
        Delivered
      </span>
    );
  }
  const cls = BUCKET_STYLES[bucket];
  const strike = bucket === "overdue" ? "line-through decoration-2" : "";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono border ${cls} ${strike}`}
    >
      {label}
    </span>
  );
}

const STATUS_LABEL: Record<TrialIntakeStatus, string> = {
  pending_se_assignment: "PENDING SE",
  in_progress: "IN PROGRESS",
  delivered: "DELIVERED",
  overdue: "OVERDUE",
};

const STATUS_STYLE: Record<TrialIntakeStatus, string> = {
  pending_se_assignment: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress:
    "bg-severity-action-bg text-severity-action border-severity-action/20",
  delivered:
    "bg-severity-green-bg text-severity-green border-severity-green/20",
  overdue:
    "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20",
};

export function StatusBadge({ status }: { status: TrialIntakeStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
