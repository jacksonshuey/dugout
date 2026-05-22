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
  loadPreset,
  resetWorkspace,
  saveWorkspaceConfig,
} from "@/app/actions/workspace";
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
    startTransition(async () => {
      await loadPreset(name);
      setConfig(PRESETS[name]);
      setSavedAt(new Date().toLocaleTimeString());
      router.refresh();
    });
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
              <div className="flex items-start gap-3">
                <Input
                  value={p.id}
                  onChange={(v) => updatePriority(i, { id: v })}
                  className="w-16 font-mono"
                />
                <div className="flex-1 space-y-2">
                  <Input
                    value={p.name}
                    onChange={(v) => updatePriority(i, { name: v })}
                    placeholder="Priority name"
                  />
                  <Textarea
                    value={p.description}
                    onChange={(v) => updatePriority(i, { description: v })}
                    rows={2}
                    placeholder="One-paragraph description"
                  />
                </div>
                <button
                  onClick={() => removePriority(i)}
                  className="text-xs text-muted hover:text-severity-blocking shrink-0 px-2 py-1"
                  title="Remove priority"
                >
                  Remove
                </button>
              </div>
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
