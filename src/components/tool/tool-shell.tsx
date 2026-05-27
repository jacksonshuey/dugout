"use client";

import { useEffect, useState } from "react";
import { Console, type ConsoleData } from "@/components/console";
import { InteractiveSignals } from "@/components/landing/interactive-signals";
import { InteractiveDecisions } from "@/components/landing/interactive-decisions";
import { IntegrationSetupReel } from "@/components/landing/integration-setup-reel";
import { IntegrationsMatrix } from "@/components/landing/integrations-matrix";
import type { IntegrationSpec } from "@/data/integrations";
import type { IntegrationHealth } from "@/lib/integration-health";
import { ConnectivityGraph } from "@/components/tool/connectivity-graph";
import { IntegrationConnectModal } from "@/components/tool/integration-connect-modal";
import { WorkspaceTree } from "@/components/tool/workspace-tree";
import { ExampleRules } from "@/components/tool/example-rules";
import { CANONICAL_OBJECTS, type CanonicalObject } from "@/data/canonical-objects";
import {
  rawFieldsContributingTo,
  contributorsFor,
  totalMappingCount,
  joinPointFields,
  unmappedRawFields,
} from "@/data/object-mappings";
import { totalRawFieldCount, getUniqueSources, getRawObjectsBySource } from "@/data/raw-fields";
import { INTEGRATION_SPECS } from "@/data/integration-specs";
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
      {tab === "integrations" && (
        <IntegrationsTab
          integrations={props.integrations}
          health={props.integrationHealth}
        />
      )}
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

function IntegrationsTab({
  integrations,
  health,
}: {
  integrations: IntegrationSpec[];
  health: Record<string, IntegrationHealth>;
}) {
  const [openSpec, setOpenSpec] = useState<IntegrationConnectSpec | null>(null);
  return (
    <div>
      <TabHeader
        title="Integrations"
        sub="Dugout reads from your existing stack. The only places it writes are Slack (signal delivery) and Calendly (booking links). Credentials encrypt in Supabase Vault and never reach the browser."
      />
      <div className="max-w-6xl mx-auto px-6 pb-8 space-y-6">
        <SourceConnectGrid onConnect={(s) => setOpenSpec(s)} />
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
            Setup walkthrough demo
          </div>
          <IntegrationSetupReel integrations={integrations} health={health} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
            Status overview
          </div>
          <IntegrationsMatrix health={health} />
        </div>
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

// Local alias so the import surface in this file stays clean.
type IntegrationConnectSpec = Parameters<
  typeof IntegrationConnectModal
>[0]["spec"];

// Ambient data sources Dugout manages on the customer's behalf - no
// customer credential, no popup. They still show up in the connectivity
// graph as canonical-object contributors, but aren't presented as
// "Connect X" cards because there's nothing for the customer to fill in.
const AMBIENT_SOURCES = new Set(["SEC EDGAR", "NewsAPI"]);

function SourceConnectGrid({
  onConnect,
}: {
  onConnect: (spec: IntegrationConnectSpec) => void;
}) {
  const reads = INTEGRATION_SPECS.filter(
    (s) => s.direction === "read" && !AMBIENT_SOURCES.has(s.source),
  );
  const writes = INTEGRATION_SPECS.filter(
    (s) => s.direction === "write" || s.direction === "both",
  );
  return (
    <div className="space-y-6">
      <ConnectGridSection
        title="Read sources"
        subtitle={`${reads.length} systems Dugout pulls from. Source of truth stays with the vendor.`}
        specs={reads}
        onConnect={onConnect}
      />
      <ConnectGridSection
        title="Outbound delivery"
        subtitle={`${writes.length} surfaces Dugout writes to. The only places Dugout pushes anything.`}
        specs={writes}
        onConnect={onConnect}
      />
    </div>
  );
}

function ConnectGridSection({
  title,
  subtitle,
  specs,
  onConnect,
}: {
  title: string;
  subtitle: string;
  specs: IntegrationConnectSpec[];
  onConnect: (spec: IntegrationConnectSpec) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
            {title} · {specs.length}
          </div>
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        </div>
      </div>
      {/* auto-rows-fr + h-full on the cards makes every cell the same
          height regardless of tagline length. The tagline gets flex-1
          so it pushes the Connect button to the bottom of the card. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-fr">
        {specs.map((spec) => {
          const objCount = getRawObjectsBySource(spec.source).length;
          return (
            <div
              key={spec.source}
              className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2 h-full"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold tracking-tight truncate">
                    {spec.source}
                  </div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted mt-0.5">
                    {spec.direction === "read"
                      ? `${objCount} object${objCount === 1 ? "" : "s"} · `
                      : ""}
                    {spec.auth.method.replace("_", " ")}
                  </div>
                </div>
                <DirectionBadge direction={spec.direction} />
              </div>
              <p className="text-[11px] text-muted leading-snug flex-1">
                {spec.tagline}
              </p>
              <button
                type="button"
                onClick={() => onConnect(spec)}
                className="mt-1 text-xs font-semibold py-1.5 rounded-md bg-brand text-white hover:bg-brand/90 transition-colors"
              >
                Connect
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: "read" | "write" | "both";
}) {
  const config = {
    read: {
      label: "read",
      cls: "border-severity-action/40 bg-severity-action-bg text-severity-action",
    },
    write: {
      label: "write",
      cls: "border-brand/40 bg-brand/[0.08] text-brand",
    },
    both: {
      label: "r+w",
      cls: "border-severity-awareness/40 bg-severity-awareness-bg text-severity-awareness",
    },
  }[direction];
  return (
    <span
      className={
        "shrink-0 text-[9px] font-mono uppercase tracking-[0.15em] px-1.5 py-0.5 rounded border " +
        config.cls
      }
    >
      {config.label}
    </span>
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
  const [graphOpen, setGraphOpen] = useState(false);
  const sources = getUniqueSources();
  return (
    <div>
      <TabHeader
        title="Ontology"
        sub="Raw API fields from every source zipper into canonical objects. One Meeting, one Account, one Deal, regardless of how many tools recorded it."
      />
      <div className="max-w-6xl mx-auto px-6 pb-6">
        <button
          type="button"
          onClick={() => setGraphOpen(true)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:border-brand hover:text-brand transition-colors"
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="w-4 h-4"
          >
            <circle cx="3" cy="4" r="1.5" />
            <circle cx="3" cy="12" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
            <path d="M4.5 4 L11.5 7.5" />
            <path d="M4.5 12 L11.5 8.5" />
          </svg>
          Visualize data zipper
        </button>
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-6">
        <OntologyStatsRow sourceCount={sources.length} />
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <CanonicalObjectsGrid />
      </div>
      <div className="max-w-6xl mx-auto px-6 pb-12">
        <WorkspaceTree />
      </div>
      {graphOpen && <ConnectivityGraphModal onClose={() => setGraphOpen(false)} />}
    </div>
  );
}

function OntologyStatsRow({ sourceCount }: { sourceCount: number }) {
  const joins = joinPointFields();
  const orphans = unmappedRawFields();
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
      <Stat label="Sources" value={String(sourceCount)} />
      <Stat label="Raw fields" value={String(totalRawFieldCount())} />
      <Stat label="Canonical objects" value={String(CANONICAL_OBJECTS.length)} />
      <Stat label="Mappings" value={String(totalMappingCount())} accent />
      <Stat label="Join points" value={String(joins.length)} sub={`${orphans.length} orphans`} accent />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border px-3 py-2 " +
        (accent
          ? "border-brand/40 bg-brand/[0.04]"
          : "border-border bg-background")
      }
    >
      <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function CanonicalObjectsGrid() {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-2">
        Canonical objects
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {CANONICAL_OBJECTS.map((obj) => (
          <CanonicalObjectCard key={obj.key} obj={obj} />
        ))}
      </div>
    </div>
  );
}

function CanonicalObjectCard({ obj }: { obj: CanonicalObject }) {
  const contribs = rawFieldsContributingTo(obj.key);
  const sources = Array.from(new Set(contribs.map((c) => c.source)));
  const joinFields = obj.fields.filter(
    (f) => contributorsFor(obj.key, f.key).length > 1,
  ).length;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
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
    </div>
  );
}

function ConnectivityGraphModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Data zipper graph"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-xl border border-border shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3 shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
              Data zipper
            </div>
            <h3 className="text-base font-semibold tracking-tight mt-0.5">
              Sources → canonical objects
            </h3>
            <p className="text-xs text-muted mt-0.5 max-w-2xl">
              Overview shows how each source contributes to the canonical
              objects. Drill in to see exactly which raw fields converge on
              each canonical field. Join-point fields (multiple sources
              agree or disagree on the same value) are flagged.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md border border-border w-7 h-7 inline-flex items-center justify-center hover:border-brand hover:text-brand transition-colors"
          >
            <svg
              aria-hidden
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="w-4 h-4"
            >
              <path d="M4 4 L12 12" />
              <path d="M12 4 L4 12" />
            </svg>
          </button>
        </header>
        <div className="overflow-auto p-5">
          <ConnectivityGraph />
        </div>
      </div>
    </div>
  );
}
