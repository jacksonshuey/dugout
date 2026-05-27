"use client";

import { useState } from "react";
import { Console, type ConsoleData } from "@/components/console";
import { InteractiveSignals } from "@/components/landing/interactive-signals";
import { InteractiveDecisions } from "@/components/landing/interactive-decisions";
import type { IntegrationSpec } from "@/data/integrations";
import type { IntegrationHealth } from "@/lib/integration-health";
import { ConnectivityGraph } from "@/components/tool/connectivity-graph";
import { IntegrationsTable } from "@/components/tool/integrations-table";
import { WorkspaceTree } from "@/components/tool/workspace-tree";
import { ExampleRules } from "@/components/tool/example-rules";
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
  return (
    <div>
      <TabHeader
        title="Ontology"
        sub="Raw API fields from every source zipper into canonical objects. Click any source or canonical object to unravel its mappings inline."
      />
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
          Data zipper · sources → canonical objects
        </div>
        <div className="rounded-xl border border-border bg-foreground/[0.02] p-4">
          <ConnectivityGraph />
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <WorkspaceTree />
      </div>
    </div>
  );
}


