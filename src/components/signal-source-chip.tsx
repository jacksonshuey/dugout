"use client";

import { useState } from "react";
import { RawEmailDrawer } from "./raw-email-drawer";

// Source-attribution chip for a single market-intel signal.
//
// Renders, in order: publisher chip + subject line + view-source link +
// "view raw email" drawer trigger. Falls back to `sender_domain` when
// `publisher_canonical_name` is missing (older pre-attribution rows —
// Q8 resolution, docs/filter-design.md §12).
//
// Stateless except for the drawer open/closed boolean. The parent passes
// the resolved display + URL fields; the chip does not query Supabase
// (per BUILD_ALIGNMENT #7).

export interface SignalSourceChipProps {
  publisherDisplayName: string | null;
  senderDomainFallback: string | null;
  emailSubject: string | null;
  sourceUrl: string | null;
  inboundEmailId: string | null;
  signalId: string;
}

export function SignalSourceChip(props: SignalSourceChipProps) {
  const {
    publisherDisplayName,
    senderDomainFallback,
    emailSubject,
    sourceUrl,
    inboundEmailId,
    signalId,
  } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const publisherLabel = publisherDisplayName ?? senderDomainFallback ?? "—";

  async function submitFeedback() {
    if (!feedbackReason.trim()) return;
    setFeedbackBusy(true);
    setFeedbackMsg(null);
    try {
      const r = await fetch("/api/admin/signal-feedback", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signal_id: signalId,
          reason: feedbackReason,
        }),
      });
      const json = (await r.json()) as { error?: string };
      if (!r.ok || json.error) {
        setFeedbackMsg(json.error ?? `HTTP ${r.status}`);
      } else {
        setFeedbackMsg("Marked bad — refresh to see it disappear.");
        setFeedbackReason("");
      }
    } catch (e) {
      setFeedbackMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setFeedbackBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border border-border bg-brand/5 text-brand-dark">
          {publisherLabel}
        </span>
        {emailSubject && (
          <span className="text-muted italic truncate max-w-md">
            {emailSubject}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[11px]">
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand hover:underline"
          >
            View source
          </a>
        )}
        {inboundEmailId && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-muted hover:text-foreground underline"
          >
            View raw email
          </button>
        )}
        <button
          onClick={() => setFeedbackOpen((v) => !v)}
          className="text-muted hover:text-severity-red underline"
        >
          Mark bad
        </button>
      </div>
      {feedbackOpen && (
        <div className="mt-2 p-2 border border-border rounded bg-black/[0.02] space-y-2">
          <input
            type="text"
            value={feedbackReason}
            onChange={(e) => setFeedbackReason(e.target.value)}
            placeholder="Why is this a bad signal?"
            className="w-full text-xs px-2 py-1 border border-border rounded"
            disabled={feedbackBusy}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitFeedback}
              disabled={feedbackBusy || feedbackReason.trim().length === 0}
              className="text-xs px-2 py-1 bg-foreground text-white rounded disabled:opacity-50"
            >
              {feedbackBusy ? "Saving…" : "Submit"}
            </button>
            <button
              onClick={() => {
                setFeedbackOpen(false);
                setFeedbackReason("");
                setFeedbackMsg(null);
              }}
              className="text-xs text-muted hover:text-foreground"
            >
              Cancel
            </button>
            {feedbackMsg && (
              <span className="text-xs text-muted">{feedbackMsg}</span>
            )}
          </div>
        </div>
      )}
      {inboundEmailId && (
        <RawEmailDrawer
          inboundEmailId={inboundEmailId}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
