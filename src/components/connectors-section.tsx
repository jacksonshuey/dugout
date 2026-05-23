"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  connectGranola,
  disconnectGranola,
  syncGranolaNow,
} from "@/app/actions/granola";
import type { WorkspaceIntegrationStatus } from "@/lib/workspace-integrations";
import type { SyncResult } from "@/lib/granola-adapter";
import { Button, Card } from "./ui";

// Connectors section — third-party API key management. Currently houses
// Granola; designed so future connectors slot in as additional cards.
//
// API key is paste-only (write-only field). We NEVER read the plaintext back
// to the browser — once Vault has it, the only client-side state is "is it
// connected" and "when was the last sync."

export function ConnectorsSection({
  granolaStatus,
}: {
  granolaStatus: WorkspaceIntegrationStatus;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Connectors</h2>
        <p className="text-xs text-muted mt-0.5 max-w-2xl">
          Bring meeting + CRM signals into Dugout. API keys are stored
          encrypted via Supabase Vault (libsodium); plaintext never returns
          to the browser after you paste it.
        </p>
      </div>
      <GranolaConnector status={granolaStatus} />
    </section>
  );
}

function GranolaConnector({ status }: { status: WorkspaceIntegrationStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  function reset() {
    setError(null);
    setSuccess(null);
  }

  function connect() {
    reset();
    if (!apiKey.trim()) {
      setError("Paste a key first.");
      return;
    }
    startTransition(async () => {
      const r = await connectGranola(apiKey);
      if (r.ok) {
        setSuccess(
          `Connected. List endpoint returned ${r.sampleNoteCount ?? 0} note${
            r.sampleNoteCount === 1 ? "" : "s"
          } on the first page.`,
        );
        setApiKey("");
        router.refresh();
      } else {
        setError(r.error ?? "Could not verify the key.");
      }
    });
  }

  function rotate() {
    reset();
    if (!apiKey.trim()) {
      setError("Paste a key first.");
      return;
    }
    startTransition(async () => {
      const r = await connectGranola(apiKey);
      if (r.ok) {
        setSuccess("Key rotated.");
        setApiKey("");
        router.refresh();
      } else {
        setError(r.error ?? "Could not verify the key.");
      }
    });
  }

  function disconnect() {
    if (
      !window.confirm(
        "Disconnect Granola? This revokes the key from Vault. You can reconnect by pasting a new key.",
      )
    ) {
      return;
    }
    reset();
    startTransition(async () => {
      await disconnectGranola();
      setSuccess("Disconnected.");
      router.refresh();
    });
  }

  function syncNow() {
    reset();
    setSyncResult(null);
    startTransition(async () => {
      const r = await syncGranolaNow();
      setSyncResult(r);
      if (r.status === "error") {
        setError(r.errors[0]?.message ?? "Sync failed.");
      } else {
        const parts: string[] = [];
        parts.push(`${r.totalNotes} note${r.totalNotes === 1 ? "" : "s"} pulled`);
        parts.push(`${r.matched} matched`);
        parts.push(`${r.signalsWritten} signal${r.signalsWritten === 1 ? "" : "s"} written`);
        if (r.unassigned.length > 0) {
          parts.push(`${r.unassigned.length} unassigned`);
        }
        if (r.internalSkipped > 0) {
          parts.push(`${r.internalSkipped} internal skipped`);
        }
        setSuccess(parts.join(" · "));
      }
      router.refresh();
    });
  }

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Granola</h3>
            {status.connected ? (
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-severity-green-bg text-severity-green border border-severity-green/20">
                Connected
              </span>
            ) : (
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border">
                Not connected
              </span>
            )}
          </div>
          <p className="text-xs text-muted max-w-md">
            Pulls meeting notes + summaries, classifies them for buying-process
            signals (Finance missing, new stakeholders, champion changes), and
            surfaces them on the right account&apos;s deal drawer.
          </p>
        </div>
        {status.connected && (
          <div className="flex gap-2 shrink-0">
            <Button
              variant="primary"
              onClick={syncNow}
              disabled={pending}
            >
              {pending ? "Syncing…" : "Sync now"}
            </Button>
            <Link
              href="/integrations/granola"
              className="inline-flex items-center px-4 h-9 rounded-lg text-sm font-medium bg-slate-100 text-slate-900 hover:bg-slate-200"
            >
              Manage meetings
            </Link>
          </div>
        )}
      </div>

      {/* Key paste field — always visible. Different button labels for
          new connection vs rotation. */}
      <div className="space-y-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wider text-muted font-medium">
            API key
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="grn_..."
            className="w-full mt-1 rounded-md border border-border bg-background px-3 h-9 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
        </label>
        <div className="flex gap-2 flex-wrap">
          {status.connected ? (
            <>
              <Button
                variant="secondary"
                onClick={rotate}
                disabled={pending || apiKey.length === 0}
              >
                Rotate key
              </Button>
              <Button
                variant="ghost"
                onClick={disconnect}
                disabled={pending}
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={connect}
              disabled={pending || apiKey.length === 0}
            >
              {pending ? "Verifying…" : "Connect"}
            </Button>
          )}
          <span className="text-[11px] text-muted self-center">
            Get a key: Granola desktop app → Settings → Connectors → API keys.
          </span>
        </div>
      </div>

      {/* Status row */}
      {status.connected && (
        <div className="text-xs text-muted border-t border-border pt-3 space-y-1">
          <div>
            Last sync:{" "}
            {status.lastSyncedAt ? (
              <>
                <span className="text-foreground">
                  {new Date(status.lastSyncedAt).toLocaleString()}
                </span>
                {status.lastSyncStatus && (
                  <span
                    className={
                      status.lastSyncStatus === "success"
                        ? "ml-2 text-severity-green"
                        : status.lastSyncStatus === "partial"
                          ? "ml-2 text-severity-action"
                          : "ml-2 text-severity-blocking"
                    }
                  >
                    · {status.lastSyncStatus}
                  </span>
                )}
              </>
            ) : (
              <span className="italic">never (run sync now)</span>
            )}
          </div>
          {status.lastSyncError && (
            <div className="text-severity-blocking font-mono opacity-80">
              {status.lastSyncError.slice(0, 240)}
            </div>
          )}
        </div>
      )}

      {/* Inline feedback */}
      {error && (
        <div className="text-xs text-severity-blocking border-t border-border pt-3">
          <div className="font-medium">Error</div>
          <div className="font-mono opacity-80 mt-0.5">{error}</div>
        </div>
      )}
      {success && !error && (
        <div className="text-xs text-severity-green border-t border-border pt-3">
          {success}
        </div>
      )}
      {syncResult &&
        !error &&
        syncResult.unassigned.length > 0 && (
          <div className="text-xs border-t border-border pt-3">
            <Link
              href="/integrations/granola"
              className="text-brand font-medium hover:underline"
            >
              {syncResult.unassigned.length} meeting
              {syncResult.unassigned.length === 1 ? "" : "s"} couldn&apos;t be
              matched — assign them →
            </Link>
          </div>
        )}
    </Card>
  );
}
