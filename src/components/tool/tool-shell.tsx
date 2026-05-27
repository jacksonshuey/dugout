"use client";

import { useRef, useState } from "react";
import { Console, type ConsoleData } from "@/components/console";
import { InteractiveSignals } from "@/components/landing/interactive-signals";
import { InteractiveDecisions } from "@/components/landing/interactive-decisions";
import type { IntegrationSpec } from "@/data/integrations";
import type { IntegrationHealth } from "@/lib/integration-health";
import { ConnectivityGraph } from "@/components/tool/connectivity-graph";
import { IntegrationConnectModal } from "@/components/tool/integration-connect-modal";
import { IntegrationsTable } from "@/components/tool/integrations-table";
import { WorkspaceTree } from "@/components/tool/workspace-tree";
import { ExampleRules } from "@/components/tool/example-rules";
import { CANONICAL_OBJECTS, type CanonicalObject } from "@/data/canonical-objects";
import {
  rawFieldsContributingTo,
  contributorsFor,
} from "@/data/object-mappings";
import {
  getSpec,
  type IntegrationSpec as IntegrationConnectSpec,
} from "@/data/integration-specs";
import { cn } from "@/lib/utils";

// Tabbed shell for the operator tool surface. Tab state is local only (no
// URL serialization) so Console's existing ?owners=&stages= URL state
// doesn't collide.
//
// Tab vocabulary aligns with the broader rename: Decisions → Actions
// everywhere. "Rules & Actions" became just "Rules" since Actions has
// its own tab.

type TabKey =
  | "dashboard"
  | "integrations"
  | "rules"
  | "actions"
  | "ontology";

const TABS: { key: TabKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "integrations", label: "Integrations" },
  { key: "rules", label: "Rules" },
  { key: "actions", label: "Actions" },
  { key: "ontology", label: "Ontology" },
];

interface ToolShellProps extends ConsoleData {
  integrations: IntegrationSpec[];
  integrationHealth: Record<string, IntegrationHealth>;
}

export function ToolShell(props: ToolShellProps) {
  const [tab, setTab] = useState<TabKey>("dashboard");
  return (
    <div className="bg-background min-h-screen">
      <div className="border-b border-border bg-background sticky top-12 z-20">
        <div className="max-w-6xl mx-auto px-6">
          <nav
            className="flex items-center gap-1 overflow-x-auto"
            role="tablist"
            aria-label="Tool sections"
          >
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center h-10 px-3 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "text-brand font-semibold border-b-2 border-brand"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
      {tab === "dashboard" && <DashboardTab {...props} />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "rules" && <RulesTab />}
      {tab === "actions" && <ActionsTab />}
      {tab === "ontology" && <OntologyTab />}
    </div>
  );
}

function TabHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="max-w-6xl mx-auto px-6 pt-8 pb-4">
      <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted max-w-2xl leading-relaxed">{sub}</p>
    </div>
  );
}

function DashboardTab(props: ToolShellProps) {
  return (
    <div className="pt-4">
      <Console
        basePath="/tool"
        hideSidebar
        pipelineTitle="Dashboard"
        signals={props.signals}
        opportunities={props.opportunities}
        accounts={props.accounts}
        contacts={props.contacts}
        activities={props.activities}
        calls={props.calls}
        deliveries={props.deliveries}
        reps={props.reps}
        workspace={props.workspace}
      />
    </div>
  );
}

function IntegrationsTab() {
  // The table is the main surface. Status, auth, direction, sync model,
  // and the Connect button all live in the row. Connect popup spawns
  // from the row's button; on save the row flips to Connected.
  return (
    <div>
      <TabHeader
        title="Integrations"
        sub="Dugout reads from your existing stack. The only places it writes are Slack (signal delivery) and Calendly (booking links). Credentials encrypt in Supabase Vault and never reach the browser."
      />
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <IntegrationsTable />
      </div>
    </div>
  );
}


function RulesTab() {
  return (
    <div>
      <TabHeader
        title="Rules"
        sub="A rule is a trigger plus the action it fires. Build one from ontology fields, news, meetings, or AI extraction. Every rule must end in an action — Slack ping, Calendly link, drafted email."
      />
      <div className="max-w-6xl mx-auto px-6 pb-6">
        <ExampleRules />
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
          Rule composer
        </div>
        <InteractiveSignals />
      </div>
    </div>
  );
}

function ActionsTab() {
  return (
    <div>
      <TabHeader
        title="Actions"
        sub="The log of what rules have fired. Every row traces back to the rule that triggered it. Acted, skipped, or snoozed — all auditable."
      />
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <InteractiveDecisions />
      </div>
    </div>
  );
}

function OntologyTab() {
  // Controlled state for the inline data zipper so card clicks below
  // can drive it (e.g., clicking a canonical object card jumps the
  // graph into drill-in mode for that object).
  const [graphMode, setGraphMode] = useState<"overview" | "drilldown">(
    "overview",
  );
  const [graphSelectedObject, setGraphSelectedObject] = useState<string>(
    CANONICAL_OBJECTS[0]?.key ?? "Account",
  );
  // Source clicks open the integration connect modal.
  const [openSpec, setOpenSpec] = useState<IntegrationConnectSpec | null>(
    null,
  );
  // Ref so card clicks scroll the graph back into view.
  const graphRef = useRef<HTMLDivElement | null>(null);

  function openCanonicalDrillIn(key: string) {
    setGraphSelectedObject(key);
    setGraphMode("drilldown");
    graphRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openSourceConnect(source: string) {
    const spec = getSpec(source);
    if (spec) setOpenSpec(spec);
  }

  return (
    <div>
      <TabHeader
        title="Ontology"
        sub="Raw API fields from every source zipper into canonical objects. Click any source to connect it; click any canonical object to see the join."
      />
      <div className="max-w-6xl mx-auto px-6 pb-8" ref={graphRef}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
          Data zipper · sources → canonical objects
        </div>
        <div className="rounded-xl border border-border bg-foreground/[0.02] p-4">
          <ConnectivityGraph
            mode={graphMode}
            selectedObject={graphSelectedObject}
            onModeChange={setGraphMode}
            onSelectedObjectChange={setGraphSelectedObject}
            onSelectSource={openSourceConnect}
          />
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <CanonicalObjectsGrid onSelect={openCanonicalDrillIn} />
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <WorkspaceTree />
      </div>
      {openSpec && (
        <IntegrationConnectModal
          spec={openSpec}
          onClose={() => setOpenSpec(null)}
        />
      )}
    </div>
  );
}

function CanonicalObjectsGrid({
  onSelect,
}: {
  onSelect: (canonicalKey: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
        Canonical objects · click to drill into the zipper above
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {CANONICAL_OBJECTS.map((obj) => (
          <CanonicalObjectCard key={obj.key} obj={obj} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function CanonicalObjectCard({
  obj,
  onSelect,
}: {
  obj: CanonicalObject;
  onSelect: (canonicalKey: string) => void;
}) {
  const contribs = rawFieldsContributingTo(obj.key);
  const sources = Array.from(new Set(contribs.map((c) => c.source)));
  const joinFields = obj.fields.filter(
    (f) => contributorsFor(obj.key, f.key).length > 1,
  ).length;
  return (
    <button
      type="button"
      onClick={() => onSelect(obj.key)}
      className="rounded-lg border border-border bg-background p-3 text-left hover:border-brand hover:shadow-sm transition-all w-full focus:outline-none focus:ring-2 focus:ring-brand/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-tight">{obj.label}</div>
          <div className="text-[11px] text-muted mt-0.5 leading-snug max-w-md">
            {obj.description}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
            fields
          </div>
          <div className="text-sm font-mono font-semibold">{obj.fields.length}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap text-[10px] font-mono">
        {sources.map((s) => (
          <span
            key={s}
            className="inline-flex items-center px-1.5 py-0.5 rounded border border-border bg-foreground/[0.02]"
            title={`${s} contributes`}
          >
            {s}
          </span>
        ))}
        {sources.length === 0 && (
          <span className="text-muted italic">no contributing sources</span>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
        <span>
          <span className="font-mono font-semibold text-foreground">
            {contribs.length}
          </span>{" "}
          raw contribs
        </span>
        {joinFields > 0 && (
          <span className="text-brand">
            <span className="font-mono font-semibold">{joinFields}</span> join{" "}
            {joinFields === 1 ? "point" : "points"}
          </span>
        )}
      </div>
    </button>
  );
}

