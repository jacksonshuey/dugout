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
  assignSe,
  computeSla,
  deriveStatus,
  formatRemaining,
  loadIntakes,
  markDemoSeeded,
  markKpiDelivered,
  saveIntakes,
} from "@/lib/trial-intake";
import { buildWorkspaceKey, mergeIntakes } from "./shared";
import { StatusBadge } from "./trial-intake-list-view";

interface Props {
  intakeId: string;
  seedIntakes: TrialIntake[];
  opportunities: Opportunity[];
  accounts: Account[];
  reps: Rep[];
  workspaceCompanyName: string;
  workspacePresetName: string | undefined;
}

function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TrialIntakeDetailView({
  intakeId,
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
  const now = useNow();

  useEffect(() => {
    // See trial-intake-list-view.tsx — same client-rehydrate seam.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStoredIntakes(loadIntakes(workspaceKey));
    setHydrated(true);
  }, [workspaceKey]);

  const intake = useMemo(() => {
    const merged = mergeIntakes(seedIntakes, storedIntakes);
    return merged.find((i) => i.id === intakeId);
  }, [seedIntakes, storedIntakes, intakeId]);

  const ses = useMemo(() => reps.filter((r) => r.role === "SE"), [reps]);

  // ── Mutators ────────────────────────────────────────────────────
  // Each writes through saveIntakes() and refreshes the local copy. The
  // helper grabs the latest stored snapshot to avoid stomping concurrent
  // tab changes.
  function refresh() {
    setStoredIntakes(loadIntakes(workspaceKey));
  }

  function handleAssignSe(seId: string) {
    if (!intake) return;
    const merged = mergeIntakes(seedIntakes, loadIntakes(workspaceKey));
    const next = assignSe(workspaceKey, merged, intake.id, seId);
    // mergeIntakes-friendly write: persist only the items we actually own
    // (seed intakes that have been edited become "stored" too).
    saveIntakes(workspaceKey, next);
    refresh();
  }

  function handleMarkKpiDelivered() {
    if (!intake) return;
    const merged = mergeIntakes(seedIntakes, loadIntakes(workspaceKey));
    const next = markKpiDelivered(workspaceKey, merged, intake.id);
    saveIntakes(workspaceKey, next);
    refresh();
  }

  function handleMarkDemoSeeded() {
    if (!intake) return;
    const merged = mergeIntakes(seedIntakes, loadIntakes(workspaceKey));
    const next = markDemoSeeded(workspaceKey, merged, intake.id);
    saveIntakes(workspaceKey, next);
    refresh();
  }

  if (!hydrated) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (!intake) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-3 text-center">
        <h1 className="text-xl font-semibold">Intake not found</h1>
        <p className="text-sm text-muted">
          This intake ID doesn&apos;t exist in seed data or in this browser&apos;s
          local store.
        </p>
        <Link href="/trial-intake" className="text-brand hover:underline text-sm">
          ← Back to active intakes
        </Link>
      </div>
    );
  }

  const opp = opportunities.find((o) => o.id === intake.oppId);
  const account = accounts.find((a) => a.id === intake.accountId);
  const ae = reps.find((r) => r.id === intake.submittedBy);
  const se = intake.assignedSeId
    ? reps.find((r) => r.id === intake.assignedSeId)
    : undefined;
  const status: TrialIntakeStatus = deriveStatus(intake, now);
  const sla = computeSla(intake, now);

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header className="space-y-2">
        <Link
          href="/trial-intake"
          className="text-xs text-muted hover:text-foreground inline-flex"
        >
          ← Back to active intakes
        </Link>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
              Trial intake
            </div>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">
              {account?.name ?? intake.accountId}
            </h1>
            <p className="text-sm text-muted">
              {opp?.name ?? intake.oppId} · {opp?.stage ?? "—"}
            </p>
          </div>
          <StatusBadge status={status} />
        </div>
      </header>

      {/* SLA + meta */}
      <section className="grid sm:grid-cols-3 gap-3">
        <SlaCard sla={sla} delivered={intake.status === "delivered"} />
        <MetaCard
          label="Submitted by"
          primary={ae?.name ?? intake.submittedBy}
          secondary={formatDateTime(intake.submittedAt)}
        />
        <MetaCard
          label="SE assigned"
          primary={se?.name ?? "Unassigned"}
          secondary={se?.email}
        />
      </section>

      {/* Actions */}
      <section className="rounded-2xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">State transitions</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {intake.status === "pending_se_assignment" && (
            <>
              <span className="text-xs text-muted mr-1">Assign SE:</span>
              {ses.length === 0 && (
                <span className="text-xs text-muted">No SEs in roster.</span>
              )}
              {ses.map((s) => (
                <Button
                  key={s.id}
                  variant="secondary"
                  onClick={() => handleAssignSe(s.id)}
                >
                  {s.name}
                </Button>
              ))}
            </>
          )}
          {intake.status === "in_progress" && (
            <>
              <Button onClick={handleMarkKpiDelivered}>
                Mark KPI delivered
              </Button>
              <Button variant="secondary" onClick={handleMarkDemoSeeded}>
                {intake.demoSeededAt ? "Demo re-seeded" : "Mark demo seeded"}
              </Button>
            </>
          )}
          {intake.status === "delivered" && (
            <div className="text-xs text-muted">
              Delivered{" "}
              {intake.kpiAssessmentDeliveredAt
                ? formatDateTime(intake.kpiAssessmentDeliveredAt)
                : "—"}
              . No further transitions.
            </div>
          )}
        </div>
        {intake.demoSeededAt && intake.status !== "delivered" && (
          <div className="text-[11px] text-muted">
            Demo seeded {formatDateTime(intake.demoSeededAt)}.
          </div>
        )}
      </section>

      {/* Intake body */}
      <section className="rounded-2xl border border-border bg-background p-5 space-y-4">
        <h2 className="text-sm font-semibold">Intake</h2>
        <DetailBlock label="KPI hypotheses">
          {intake.kpiHypotheses.length === 0 ? (
            <Muted>None captured.</Muted>
          ) : (
            <ol className="space-y-1.5 list-decimal pl-5 text-sm leading-snug">
              {intake.kpiHypotheses.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ol>
          )}
        </DetailBlock>
        <DetailBlock label="Buyer success criteria">
          {intake.buyerSuccessCriteria ? (
            <p className="text-sm leading-snug">
              {intake.buyerSuccessCriteria}
            </p>
          ) : (
            <Muted>Not provided.</Muted>
          )}
        </DetailBlock>
        <DetailBlock label="Dataset requirements">
          {intake.datasetRequirements ? (
            <p className="text-sm leading-snug">{intake.datasetRequirements}</p>
          ) : (
            <Muted>Not provided.</Muted>
          )}
        </DetailBlock>
        <DetailBlock label="SE notes">
          {intake.seNotes ? (
            <p className="text-sm leading-snug">{intake.seNotes}</p>
          ) : (
            <Muted>None.</Muted>
          )}
        </DetailBlock>
      </section>

      {/* History */}
      <section className="rounded-2xl border border-border bg-background p-5 space-y-3">
        <h2 className="text-sm font-semibold">History</h2>
        <ol className="space-y-2 text-sm">
          {intake.history.map((e, i) => (
            <li
              key={i}
              className="flex items-baseline gap-3 border-b border-border last:border-0 pb-2 last:pb-0"
            >
              <span className="text-[11px] text-muted font-mono shrink-0 w-32">
                {formatDateTime(e.at)}
              </span>
              <span className="flex-1">
                <span className="font-medium">{e.action}</span>
                {e.detail && (
                  <span className="text-muted text-xs ml-2">· {e.detail}</span>
                )}
              </span>
              <span className="text-[11px] text-muted shrink-0">
                {e.by ?? "—"}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Pieces
// ─────────────────────────────────────────────────────────────────

function SlaCard({
  sla,
  delivered,
}: {
  sla: ReturnType<typeof computeSla>;
  delivered: boolean;
}) {
  if (delivered) {
    return (
      <div className="rounded-xl border border-severity-green/30 bg-severity-green-bg px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider font-mono text-severity-green">
          SLA
        </div>
        <div className="text-lg font-semibold text-severity-green mt-1">
          Delivered ✓
        </div>
      </div>
    );
  }
  const styles =
    sla.bucket === "healthy"
      ? "border-severity-green/30 bg-severity-green-bg text-severity-green"
      : sla.bucket === "warning"
        ? "border-severity-action/30 bg-severity-action-bg text-severity-action"
        : "border-severity-blocking/30 bg-severity-blocking-bg text-severity-blocking";
  const strike = sla.overdue ? "line-through decoration-2" : "";
  return (
    <div className={`rounded-xl border px-4 py-3 ${styles}`}>
      <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">
        SLA · 48h target
      </div>
      <div className={`text-lg font-semibold mt-1 ${strike}`}>
        {formatRemaining(sla.remainingMs)}
      </div>
    </div>
  );
}

function MetaCard({
  label,
  primary,
  secondary,
}: {
  label: string;
  primary: string;
  secondary?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted">
        {label}
      </div>
      <div className="text-sm font-semibold mt-1">{primary}</div>
      {secondary && <div className="text-[11px] text-muted">{secondary}</div>}
    </div>
  );
}

function DetailBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider font-mono text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted italic">{children}</span>;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
