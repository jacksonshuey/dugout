"use client";

// The Integrations tab's main surface. One row per source from
// INTEGRATION_SPECS, filtering out ambient sources (SEC EDGAR, NewsAPI)
// that Dugout manages on the customer's behalf.
//
// Each row carries the same operational metadata as the IntegrationsMatrix
// on the landing page (auth, direction, sync, rate limit) plus a real
// action column: "Connected" in green when the source has been wired up,
// "Connect" in brand-orange when it hasn't. Click "Connect" to open the
// per-source setup popup; on successful save the row flips to Connected.
//
// "Connected" state is local-only (localStorage) - there's no backend
// yet, so this is the demo flow. A few common-stack sources start
// connected so the table reads as "a real customer's integrations page,"
// not a fresh empty form.

import { useEffect, useState } from "react";
import {
  INTEGRATION_SPECS,
  type IntegrationSpec,
} from "@/data/integration-specs";
import { BrandLogo } from "@/components/landing/logos";
import type { BrandKey } from "@/components/landing/logos";
import { IntegrationConnectModal } from "./integration-connect-modal";

const STORAGE_KEY = "dugout-connected-integrations-v1";

// Sources Dugout manages itself - hidden from the table because there's
// no customer credential to collect.
const AMBIENT_SOURCES = new Set(["SEC EDGAR", "NewsAPI"]);

// Defaults that look like a Checkbox-shaped customer's already-wired
// stack so the demo opens in a realistic state.
const DEFAULT_CONNECTED = new Set(["Salesforce", "Slack", "Gong"]);

function sourceToBrandKey(source: string): BrandKey | null {
  const k = source.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9]/g, "");
  // The brand registry has keys like "salesforce", "chilipiper", "swyftai".
  // Loose cast: BrandLogo will fall through to a default if a key isn't
  // recognized, but every spec source today has a matching brand key.
  return k as BrandKey;
}

export function IntegrationsTable() {
  const [connected, setConnected] = useState<Set<string>>(
    () => new Set(DEFAULT_CONNECTED),
  );
  const [hydrated, setHydrated] = useState(false);
  const [openSpec, setOpenSpec] = useState<IntegrationSpec | null>(null);

  // Hydrate from localStorage so the user's earlier "connects" persist.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setConnected(new Set(arr));
        }
      }
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(connected)));
    } catch {
      // quota
    }
  }, [connected, hydrated]);

  const specs = INTEGRATION_SPECS.filter(
    (s) => !AMBIENT_SOURCES.has(s.source),
  );
  const reads = specs.filter((s) => s.direction === "read");
  const writes = specs.filter(
    (s) => s.direction === "write" || s.direction === "both",
  );

  function markConnected(source: string) {
    setConnected((prev) => {
      const next = new Set(prev);
      next.add(source);
      return next;
    });
  }

  function markDisconnected(source: string) {
    setConnected((prev) => {
      const next = new Set(prev);
      next.delete(source);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <TableSection
        title="Read sources"
        subtitle={`${reads.length} systems Dugout pulls from. Source of truth stays with the vendor.`}
        specs={reads}
        connected={connected}
        onConnect={(spec) => setOpenSpec(spec)}
        onDisconnect={markDisconnected}
      />
      <TableSection
        title="Outbound delivery"
        subtitle={`${writes.length} surfaces Dugout writes to. The only places Dugout pushes anything.`}
        specs={writes}
        connected={connected}
        onConnect={(spec) => setOpenSpec(spec)}
        onDisconnect={markDisconnected}
      />
      {openSpec && (
        <IntegrationConnectModal
          spec={openSpec}
          onClose={() => setOpenSpec(null)}
          onConnected={() => {
            markConnected(openSpec.source);
          }}
        />
      )}
    </div>
  );
}

function TableSection({
  title,
  subtitle,
  specs,
  connected,
  onConnect,
  onDisconnect,
}: {
  title: string;
  subtitle: string;
  specs: readonly IntegrationSpec[];
  connected: Set<string>;
  onConnect: (spec: IntegrationSpec) => void;
  onDisconnect: (source: string) => void;
}) {
  const connectedCount = specs.filter((s) => connected.has(s.source)).length;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
            {title} · {specs.length}
          </div>
          <p className="text-xs text-muted mt-0.5">{subtitle}</p>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-muted">
          {connectedCount} / {specs.length} connected
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-foreground/[0.02]">
              <Th>Integration</Th>
              <Th className="hidden sm:table-cell">Direction</Th>
              <Th className="hidden md:table-cell">Auth</Th>
              <Th className="hidden lg:table-cell">Sync</Th>
              <Th className="hidden xl:table-cell">Rate limit</Th>
              <Th className="text-right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {specs.map((spec) => (
              <Row
                key={spec.source}
                spec={spec}
                isConnected={connected.has(spec.source)}
                onConnect={() => onConnect(spec)}
                onDisconnect={() => onDisconnect(spec.source)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  spec,
  isConnected,
  onConnect,
  onDisconnect,
}: {
  spec: IntegrationSpec;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const brand = sourceToBrandKey(spec.source);
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-3 align-middle">
        <div className="flex items-center gap-3">
          <div className="shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md bg-foreground/[0.04]">
            {brand ? (
              <BrandLogo brand={brand} size={20} />
            ) : (
              <span className="text-[11px] font-semibold">
                {spec.source.charAt(0)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold tracking-tight">{spec.source}</div>
            <div className="text-[11px] text-muted leading-snug max-w-md">
              {spec.tagline}
            </div>
          </div>
        </div>
      </td>
      <td className="hidden sm:table-cell px-3 py-3 align-middle">
        <DirectionPill direction={spec.direction} />
      </td>
      <td className="hidden md:table-cell px-3 py-3 align-middle text-[11px] font-mono text-muted">
        {spec.auth.method.replace("_", " ")}
      </td>
      <td className="hidden lg:table-cell px-3 py-3 align-middle text-[11px] text-muted">
        {syncLabel(spec.syncModel)}
      </td>
      <td className="hidden xl:table-cell px-3 py-3 align-middle text-[11px] text-muted max-w-[200px]">
        {spec.rateLimit}
      </td>
      <td className="px-4 py-3 align-middle text-right">
        {isConnected ? (
          <ConnectedBadge onDisconnect={onDisconnect} />
        ) : (
          <ConnectButton onClick={onConnect} />
        )}
      </td>
    </tr>
  );
}

function ConnectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand text-white text-xs font-semibold hover:bg-brand/90 transition-colors"
    >
      Connect
    </button>
  );
}

function ConnectedBadge({ onDisconnect }: { onDisconnect: () => void }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-severity-action/40 bg-severity-action-bg text-severity-action text-xs font-semibold">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-severity-action"
        />
        Connected
      </span>
      <button
        type="button"
        onClick={onDisconnect}
        title="Disconnect (demo state - flips the row back to Connect)"
        aria-label="Disconnect"
        className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted hover:text-foreground transition-colors"
      >
        disconnect
      </button>
    </div>
  );
}

function DirectionPill({
  direction,
}: {
  direction: "read" | "write" | "both";
}) {
  const cfg = {
    read: { label: "read", cls: "border-foreground/20 bg-foreground/[0.03]" },
    write: { label: "write", cls: "border-brand/40 bg-brand/[0.06] text-brand" },
    both: {
      label: "read+write",
      cls: "border-severity-awareness/40 bg-severity-awareness-bg text-severity-awareness",
    },
  }[direction];
  return (
    <span
      className={
        "inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-mono uppercase tracking-[0.1em] " +
        cfg.cls
      }
    >
      {cfg.label}
    </span>
  );
}

function syncLabel(s: string): string {
  switch (s) {
    case "realtime":
      return "Real-time";
    case "webhooks":
      return "Webhooks";
    case "hourly_poll":
      return "Hourly poll";
    case "daily_sync":
      return "Daily sync";
    case "bulk_export":
      return "Bulk export";
    case "on_demand":
      return "On-demand";
    default:
      return s;
  }
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={
        "px-3 py-2 text-[10px] uppercase tracking-[0.15em] text-muted font-semibold font-mono " +
        (className ?? "")
      }
    >
      {children}
    </th>
  );
}
