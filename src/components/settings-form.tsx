"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  StandardAsset,
  StrategicPriority,
  WorkspaceConfig,
} from "@/lib/workspace";
import { PRESETS } from "@/lib/workspace";
import {
  resetWorkspace,
  saveWorkspaceConfig,
} from "@/app/actions/workspace";
import { refreshAccountSignals } from "@/app/actions/external-signals";
import { Button, Card } from "./ui";

// All settings live in one form for a single Save action. Local React state
// holds edits; server actions persist via cookie + revalidate.

const STACK_OPTIONS = {
  crm: ["Salesforce", "HubSpot", "Pipedrive", "Attio", "Close"],
  conversationIntelligence: ["Gong", "Chorus", "Granola", "Fathom", "Otter"],
  salesEngagement: ["Outreach", "Salesloft", "Apollo", "Mixmax"],
  dealRooms: ["Dock", "Aligned", "Trumpet", "Bunch"],
  meetingScheduling: ["Chili Piper", "Calendly", "Default", "Cal.com"],
  prospectingEnrichment: ["ZoomInfo", "Apollo", "Clay", "LeadIQ"],
};

export function SettingsForm({ initial }: { initial: WorkspaceConfig }) {
  const router = useRouter();
  const [config, setConfig] = useState<WorkspaceConfig>(initial);
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  function save() {
    startTransition(async () => {
      await saveWorkspaceConfig({ ...config, presetName: "Custom" });
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
  }

  function applyPreset(name: string) {
    // Preset click fills the form locally — user must click Save to persist.
    // Confirm before discarding in-flight edits.
    const isDirty = JSON.stringify(config) !== JSON.stringify(PRESETS[name]);
    if (
      isDirty &&
      !window.confirm(
        `Load the ${name} preset? Any unsaved edits will be discarded.`,
      )
    ) {
      return;
    }
    setConfig(PRESETS[name]);
    setSavedAt(null);
  }

  function reset() {
    startTransition(async () => {
      await resetWorkspace();
      setConfig(PRESETS.Checkbox);
      setSavedAt(null);
      router.refresh();
    });
  }

  function updatePriority(i: number, patch: Partial<StrategicPriority>) {
    const next = [...config.priorities];
    next[i] = { ...next[i], ...patch };
    setConfig({ ...config, priorities: next });
  }

  function addPriority() {
    setConfig({
      ...config,
      priorities: [
        ...config.priorities,
        {
          id: `P${config.priorities.length + 1}`,
          name: "New priority",
          description: "",
        },
      ],
    });
  }

  function removePriority(i: number) {
    setConfig({
      ...config,
      priorities: config.priorities.filter((_, j) => j !== i),
    });
  }

  function updateAsset(i: number, patch: Partial<StandardAsset>) {
    const next = [...config.assets];
    next[i] = { ...next[i], ...patch };
    setConfig({ ...config, assets: next });
  }

  return (
    <div className="space-y-8">
      {/* Sticky save bar */}
      <div className="sticky top-14 z-10 -mx-6 px-6 py-3 border-b border-border bg-background/95 backdrop-blur flex items-center justify-between gap-4">
        <div className="text-sm">
          <span className="text-muted">Current workspace: </span>
          <span className="font-medium">{config.companyName}</span>
          <span className="text-muted ml-1">
            ({config.presetName ?? "Custom"})
          </span>
          {savedAt && (
            <span className="text-xs text-severity-green ml-3">
              ✓ Saved at {savedAt}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={reset} disabled={pending}>
            Reset
          </Button>
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Preset chooser */}
      <Section
        title="Preset"
        sub="Load a baseline configuration. Edits on top of a preset become a Custom workspace."
      >
        <div className="flex flex-wrap gap-2">
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              disabled={pending}
              className={
                config.presetName === name
                  ? "px-4 h-10 rounded-lg bg-brand text-white text-sm font-medium"
                  : "px-4 h-10 rounded-lg border border-border text-sm font-medium hover:bg-slate-50"
              }
            >
              Load {name}
            </button>
          ))}
        </div>
      </Section>

      {/* Identity */}
      <Section
        title="Workspace identity"
        sub="Flows to the home page, digest synthesis prompt, and Signal Studio prompt."
      >
        <Card className="p-5 space-y-4">
          <Field label="Company name">
            <Input
              value={config.companyName}
              onChange={(v) => setConfig({ ...config, companyName: v })}
            />
          </Field>
          <Field label="Industry">
            <Input
              value={config.industry}
              onChange={(v) => setConfig({ ...config, industry: v })}
            />
          </Field>
          <Field label="Region">
            <Input
              value={config.region}
              onChange={(v) => setConfig({ ...config, region: v })}
            />
          </Field>
          <Field label="ICP (1–2 sentences — feeds the digest prompt)">
            <Textarea
              value={config.icpDescription}
              onChange={(v) => setConfig({ ...config, icpDescription: v })}
              rows={2}
            />
          </Field>
          <Field label="Kill point (the one-sentence diagnosis of where deals die)">
            <Textarea
              value={config.killPoint}
              onChange={(v) => setConfig({ ...config, killPoint: v })}
              rows={2}
            />
          </Field>
        </Card>
      </Section>

      {/* Priorities */}
      <Section
        title="Strategic priorities"
        sub="Signal rules tag themselves with these. Architecture page renders the catalog mapped to these. The digest prompt names them by their actual names."
      >
        <div className="space-y-2">
          {config.priorities.map((p, i) => (
            <Card key={i} className="p-4 space-y-2">
              {/* Top row: ID + Name + Remove (single horizontal line) */}
              <div className="flex items-center gap-2">
                <input
                  value={p.id}
                  onChange={(e) => updatePriority(i, { id: e.target.value })}
                  className="w-16 shrink-0 rounded-md border border-border bg-background px-2 h-9 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
                <input
                  value={p.name}
                  onChange={(e) => updatePriority(i, { name: e.target.value })}
                  placeholder="Priority name"
                  className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
                />
                <button
                  onClick={() => removePriority(i)}
                  className="text-xs text-muted hover:text-severity-blocking shrink-0 px-2 h-9"
                  title="Remove priority"
                >
                  Remove
                </button>
              </div>
              {/* Description spans full card width below */}
              <textarea
                value={p.description}
                onChange={(e) =>
                  updatePriority(i, { description: e.target.value })
                }
                rows={2}
                placeholder="One-paragraph description"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand resize-y"
              />
            </Card>
          ))}
          <button
            onClick={addPriority}
            className="text-sm text-brand font-medium hover:underline"
          >
            + Add priority
          </button>
        </div>
      </Section>

      {/* Assets */}
      <Section
        title="Standard sales assets"
        sub="Signal rules reference these by ID; AEs see them by name in the digest and console."
      >
        <Card className="p-4 space-y-2">
          {config.assets.map((a, i) => (
            <div
              key={a.id}
              className="grid grid-cols-12 gap-2 py-2 border-b border-border last:border-0"
            >
              <div className="col-span-3">
                <Input value={a.id} readOnly className="font-mono text-xs opacity-60" />
              </div>
              <div className="col-span-3">
                <Input
                  value={a.name}
                  onChange={(v) => updateAsset(i, { name: v })}
                />
              </div>
              <div className="col-span-6">
                <Input
                  value={a.description}
                  onChange={(v) => updateAsset(i, { description: v })}
                />
              </div>
            </div>
          ))}
        </Card>
      </Section>

      {/* Stack */}
      <Section
        title="GTM stack"
        sub="What this workspace integrates with. Flows to architecture data-layer copy + digest context. No real integrations yet — these are display labels with intent."
      >
        <Card className="p-5 grid sm:grid-cols-2 gap-4">
          {(
            [
              ["crm", "CRM"],
              ["conversationIntelligence", "Conversation intelligence"],
              ["salesEngagement", "Sales engagement"],
              ["dealRooms", "Deal rooms"],
              ["meetingScheduling", "Meeting scheduling"],
              ["prospectingEnrichment", "Prospecting / enrichment"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Select
                value={config.stack[key]}
                options={STACK_OPTIONS[key]}
                onChange={(v) =>
                  setConfig({
                    ...config,
                    stack: { ...config.stack, [key]: v },
                  })
                }
              />
            </Field>
          ))}
        </Card>
      </Section>

      {/* External signals (Supabase + Claude web_search) */}
      <ExternalSignalsSection />

      {/* Slack */}
      <Section
        title="Slack delivery"
        sub="Optional. If set, 'Send to Slack' in the AE Console posts a real message. Otherwise, the API returns a preview payload."
      >
        <Card className="p-5 space-y-2">
          <Field label="Incoming webhook URL">
            <Input
              value={config.slackWebhookUrl ?? ""}
              onChange={(v) => setConfig({ ...config, slackWebhookUrl: v })}
              placeholder="https://hooks.slack.com/services/..."
            />
          </Field>
          <p className="text-xs text-muted">
            Note: Slack delivery in this prototype reads the webhook URL from
            server env (<code>SLACK_WEBHOOK_URL</code>) for security. The URL
            you enter here is stored in the workspace config and shown to AEs
            as the destination channel for confidence.
          </p>
        </Card>
      </Section>
    </div>
  );
}

// External signals manual-refresh widget.
//
// Architectural note worth defending: we call the cron endpoint ONCE PER
// ACCOUNT from the browser in parallel, rather than calling the bulk endpoint
// from the browser and letting the server iterate. Reason: Vercel Hobby caps
// serverless functions at 60s, and 3 web_search calls in a server-side loop
// were timing out (504). Browser-side fan-out means each function invocation
// handles one account in ~20-30s and stays under the cap. The Vercel cron
// daily-run still uses the bulk endpoint but for 1-2 trackable accounts (we
// could split it later if we add more).

interface PerAccountResult {
  companyName: string;
  status: "success" | "error";
  inserted?: number;
  skipped?: number;
  error?: string;
  durationMs: number;
}

const TRACKABLE_ACCOUNTS = [
  { id: "acc_cobalt", name: "Stripe" },
  { id: "acc_atlas", name: "Snowflake" },
  { id: "acc_horizon", name: "Atlassian" },
];

function ExternalSignalsSection() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PerAccountResult[]>([]);
  const [totalDurationMs, setTotalDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRunning(true);
    setProgress([]);
    setError(null);
    setTotalDurationMs(null);
    const startedAt = Date.now();

    // Fire all per-account requests in parallel via server action. Each
    // action invocation stays under the 60s function cap because it
    // handles one account. As each settles, push to progress list for
    // live UI updates. Server-action path keeps CRON_SECRET server-side.
    const promises = TRACKABLE_ACCOUNTS.map(async (account): Promise<PerAccountResult> => {
      const t0 = Date.now();
      try {
        const r = await refreshAccountSignals(account.id);
        const result: PerAccountResult = {
          companyName: account.name,
          status: r.status,
          inserted: r.inserted,
          skipped: r.skipped,
          error: r.error,
          durationMs: r.durationMs,
        };
        setProgress((p) => [...p, result]);
        return result;
      } catch (e) {
        const result: PerAccountResult = {
          companyName: account.name,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          durationMs: Date.now() - t0,
        };
        setProgress((p) => [...p, result]);
        return result;
      }
    });

    await Promise.all(promises);
    setTotalDurationMs(Date.now() - startedAt);
    setRunning(false);
  }

  const summary = {
    inserted: progress.reduce((s, r) => s + (r.inserted ?? 0), 0),
    skipped: progress.reduce((s, r) => s + (r.skipped ?? 0), 0),
    errored: progress.filter((r) => r.status === "error").length,
  };
  const done = !running && progress.length === TRACKABLE_ACCOUNTS.length;

  return (
    <Section
      title="External signals"
      sub="Daily news ingestion for trackable accounts (Stripe, Snowflake, Atlassian) — NewsAPI fetches articles, Claude Haiku classifies them into material business events. Cron fires at 8am UTC; refresh below runs it on demand."
    >
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={refresh} disabled={running}>
            {running ? "Running…" : "Refresh signals now"}
          </Button>
          <span className="text-xs text-muted">
            NewsAPI fetch + Haiku classification per account · ~5s total
          </span>
        </div>

        {error && (
          <div className="text-xs text-severity-blocking border-t border-border pt-3">
            <div className="font-medium">Failed</div>
            <div className="font-mono opacity-80 mt-0.5">{error}</div>
          </div>
        )}

        {(progress.length > 0 || running) && (
          <div className="text-xs space-y-2 border-t border-border pt-3">
            <div className="font-medium">
              {done ? (
                <>
                  ✓ Done in {((totalDurationMs ?? 0) / 1000).toFixed(1)}s ·{" "}
                  <span className="text-severity-green">
                    {summary.inserted} inserted
                  </span>{" "}
                  · {summary.skipped} skipped
                  {summary.errored > 0 && (
                    <span className="text-severity-blocking">
                      {" "}
                      · {summary.errored} errored
                    </span>
                  )}
                </>
              ) : (
                <>
                  Running · {progress.length}/{TRACKABLE_ACCOUNTS.length} complete…
                </>
              )}
            </div>
            <div className="space-y-1">
              {TRACKABLE_ACCOUNTS.map((account) => {
                const r = progress.find((p) => p.companyName === account.name);
                return (
                  <div
                    key={account.id}
                    className="flex justify-between gap-3 text-muted"
                  >
                    <span className="text-foreground">{account.name}</span>
                    <span>
                      {!r ? (
                        <span className="italic">waiting…</span>
                      ) : r.status === "success" ? (
                        <>
                          {r.inserted} new · {r.skipped} dup ·{" "}
                          {(r.durationMs / 1000).toFixed(1)}s
                        </>
                      ) : (
                        <span className="text-severity-blocking">
                          {r.error?.slice(0, 80)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-xs text-muted">
          Storage: Supabase Postgres (table <code>external_signals</code>). Fictional accounts get demo seeds; trackable real companies get live web-search results with source attribution in the drawer.
        </p>
      </Card>
    </Section>
  );
}

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted mt-0.5 max-w-2xl">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-muted font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  className,
  readOnly,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  className?: string;
  readOnly?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      className={
        "w-full rounded-md border border-border bg-background px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand " +
        (className ?? "")
      }
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
    />
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-border bg-background px-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
