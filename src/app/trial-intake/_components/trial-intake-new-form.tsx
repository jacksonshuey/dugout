"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { loadTasks } from "@/lib/tasks";
import {
  appendIntake,
  createIntake,
  loadIntakes,
  resolveLinkedTrialBriefTask,
} from "@/lib/trial-intake";
import type {
  Account,
  Opportunity,
  Rep,
  TrialIntake,
} from "@/lib/types";
import { buildWorkspaceKey } from "./shared";

interface Props {
  seedIntakes: TrialIntake[];
  opportunities: Opportunity[];
  accounts: Account[];
  reps: Rep[];
  workspaceCompanyName: string;
  workspacePresetName: string | undefined;
}

// Stages eligible for trial-brief delivery. Demo Sat is the canonical trigger
// (the NO_TRIAL_BRIEF_AT_DEMO_SAT rule fires here); Evaluating+ is included
// because once an opp progresses without a brief the orchestrator is still
// the recovery path.
const ELIGIBLE_STAGES = new Set([
  "Demo Sat",
  "Evaluating",
  "Selected Vendor",
  "Contracting",
]);

export function TrialIntakeNewForm({
  seedIntakes,
  opportunities,
  accounts,
  reps,
  workspaceCompanyName,
  workspacePresetName,
}: Props) {
  const router = useRouter();
  const workspaceKey = useMemo(
    () => buildWorkspaceKey(workspacePresetName, workspaceCompanyName),
    [workspacePresetName, workspaceCompanyName],
  );

  const eligibleOpps = useMemo(
    () => opportunities.filter((o) => ELIGIBLE_STAGES.has(o.stage)),
    [opportunities],
  );

  // Accounts that have at least one eligible opp.
  const eligibleAccounts = useMemo(() => {
    const ids = new Set(eligibleOpps.map((o) => o.accountId));
    return accounts.filter((a) => ids.has(a.id));
  }, [accounts, eligibleOpps]);

  const aes = useMemo(() => reps.filter((r) => r.role === "AE"), [reps]);

  const [accountId, setAccountId] = useState<string>("");
  const [oppId, setOppId] = useState<string>("");
  const [submittedBy, setSubmittedBy] = useState<string>(
    aes[0]?.id ?? "",
  );
  const [kpi1, setKpi1] = useState("");
  const [kpi2, setKpi2] = useState("");
  const [kpi3, setKpi3] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [datasetReq, setDatasetReq] = useState("");
  const [seNotes, setSeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredOpps = useMemo(
    () =>
      accountId ? eligibleOpps.filter((o) => o.accountId === accountId) : [],
    [accountId, eligibleOpps],
  );

  // Already-active intakes shouldn't be doubled up. Built from seed + stored
  // (read at submit time so we don't race a stale snapshot).
  function alreadyHasOpenIntake(targetOppId: string): boolean {
    const all = [...seedIntakes, ...loadIntakes(workspaceKey)];
    return all.some(
      (i) => i.oppId === targetOppId && i.status !== "delivered",
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!accountId || !oppId || !submittedBy) {
      setError("Pick an account, opportunity, and AE first.");
      return;
    }
    const kpis = [kpi1, kpi2, kpi3].filter((k) => k.trim().length > 0);
    if (kpis.length === 0) {
      setError("Add at least one KPI hypothesis.");
      return;
    }
    if (alreadyHasOpenIntake(oppId)) {
      setError(
        "An open intake already exists for this opportunity. Open it from the list to update.",
      );
      return;
    }

    setSubmitting(true);
    const intake = createIntake({
      oppId,
      accountId,
      submittedBy,
      kpiHypotheses: kpis,
      buyerSuccessCriteria: successCriteria,
      datasetRequirements: datasetReq,
      seNotes,
    });

    const stored = loadIntakes(workspaceKey);
    appendIntake(workspaceKey, stored, intake);

    // Resolve the linked NO_TRIAL_BRIEF_AT_DEMO_SAT task - brief is in flight,
    // signal's behavioral premise no longer holds. No-op if there's no open
    // task (e.g. the AE hadn't loaded the Console yet).
    const tasks = loadTasks(workspaceKey);
    resolveLinkedTrialBriefTask(workspaceKey, tasks, oppId, submittedBy);

    router.push(`/trial-intake/${intake.id}`);
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
      <header className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted font-medium font-mono">
          Trial Orchestrator · new intake
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Submit a trial intake
        </h1>
        <p className="text-sm text-muted max-w-2xl">
          48-hour SLA starts the moment you submit. The linked Demo Sat
          trial-brief task on the AE Console auto-resolves on save.
        </p>
        <Link
          href="/trial-intake"
          className="text-xs text-muted hover:text-foreground inline-flex"
        >
          ← Back to active intakes
        </Link>
      </header>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border bg-background p-6 space-y-5"
      >
        <Field label="Account" required>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setOppId(""); // reset opp when account changes
            }}
            className="w-full rounded-md border border-border bg-background px-3 h-9 text-sm"
          >
            <option value="">Select an account…</option>
            {eligibleAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Opportunity"
          required
          help="Demo Sat+ deals only - earlier-stage deals don't qualify for the trial motion."
        >
          <select
            value={oppId}
            onChange={(e) => setOppId(e.target.value)}
            disabled={!accountId}
            className="w-full rounded-md border border-border bg-background px-3 h-9 text-sm disabled:bg-slate-50 disabled:text-muted"
          >
            <option value="">
              {accountId ? "Select an opportunity…" : "Pick an account first"}
            </option>
            {filteredOpps.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.stage}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Submitting AE" required>
          <select
            value={submittedBy}
            onChange={(e) => setSubmittedBy(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 h-9 text-sm"
          >
            {aes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="KPI hypotheses"
          help="Up to 3. SE will turn these into the KPI Assessment document."
        >
          <textarea
            value={kpi1}
            onChange={(e) => setKpi1(e.target.value)}
            placeholder="Hypothesis #1 - e.g. cut contract review cycle 12d → 5d"
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug"
          />
          <textarea
            value={kpi2}
            onChange={(e) => setKpi2(e.target.value)}
            placeholder="Hypothesis #2"
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug mt-2"
          />
          <textarea
            value={kpi3}
            onChange={(e) => setKpi3(e.target.value)}
            placeholder="Hypothesis #3"
            rows={2}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug mt-2"
          />
        </Field>

        <Field
          label="Buyer success criteria"
          help="What does the champion need to see before they advocate internally?"
        >
          <textarea
            value={successCriteria}
            onChange={(e) => setSuccessCriteria(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug"
          />
        </Field>

        <Field
          label="Dataset requirements"
          help="Sandbox access? Sample documents? Anonymization rules?"
        >
          <textarea
            value={datasetReq}
            onChange={(e) => setDatasetReq(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug"
          />
        </Field>

        <Field label="SE notes (optional)">
          <textarea
            value={seNotes}
            onChange={(e) => setSeNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm leading-snug"
            placeholder="Context the SE should know - landmines, prior calls, asset assumptions."
          />
        </Field>

        {error && (
          <div className="rounded-md border border-severity-blocking/30 bg-severity-blocking-bg text-severity-blocking text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Link
            href="/trial-intake"
            className="text-sm text-muted hover:text-foreground"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit intake"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  required,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">
          {label}
          {required && <span className="text-severity-blocking ml-1">*</span>}
        </span>
        {help && <span className="text-[11px] text-muted">{help}</span>}
      </div>
      {children}
    </label>
  );
}
