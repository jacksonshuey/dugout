"use client";

import { useEffect, useState } from "react";
import { MarkdownBody } from "./markdown-body";

// Centered modal that lazy-fetches the source content for a signal and renders
// it as a newsletter reader, not an admin dump. Triggered by SignalSourceChip's
// "View source" link as the primary verification path for AEs ("show me the
// exact message Dugout derived this signal from").
//
// Two render paths driven by `inboundEmailId`:
//   - Email-backed: fetch /api/admin/inbound-email/<id>, render html_body in
//     a sandboxed <iframe srcdoc>. Most faithful for publisher-styled emails.
//   - Non-email: fetch /api/admin/signal-source/<signalId>, render
//     source_content_md via MarkdownBody. Used for NewsAPI articles, Firecrawl
//     scrapes, SEC filings - the principle is universal source verification.

interface RawEmail {
  id: string;
  subject: string | null;
  from_address: string;
  from_domain: string;
  received_at: string;
  text_body: string | null;
  html_body: string | null;
  list_id?: string | null;
  publisher_canonical_name?: string | null;
}

interface SignalSource {
  id: string;
  source_content_md: string;
  source_content_kind: string | null;
  source_url: string | null;
  publisher_canonical_name: string | null;
  email_subject: string | null;
  occurred_at: string;
  summary: string;
  source: string | null;
}

const SOURCE_DISPLAY: Record<string, string> = {
  news: "NewsAPI",
  sec_edgar: "SEC EDGAR",
  web_scrape: "Firecrawl",
  newsletter: "Newsletter",
};

type LoadedSource =
  | { kind: "email"; email: RawEmail }
  | { kind: "signal"; signal: SignalSource };

export function SourcePreviewModal({
  signalId,
  inboundEmailId,
  publisherDisplayName,
  sourceUrl,
  open,
  onClose,
}: {
  signalId: string;
  inboundEmailId: string | null;
  publisherDisplayName: string | null;
  sourceUrl: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [source, setSource] = useState<LoadedSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setSource(null);
      try {
        if (inboundEmailId) {
          const r = await fetch(`/api/admin/inbound-email/${inboundEmailId}`, {
            credentials: "include",
          });
          const json = (await r.json()) as
            | { email: RawEmail }
            | { error: string };
          if (cancelled) return;
          if (!r.ok || "error" in json) {
            setError("error" in json ? json.error : `HTTP ${r.status}`);
          } else {
            setSource({ kind: "email", email: json.email });
          }
        } else {
          const r = await fetch(`/api/admin/signal-source/${signalId}`, {
            credentials: "include",
          });
          const json = (await r.json()) as
            | { signal: SignalSource }
            | { error: string };
          if (cancelled) return;
          if (!r.ok || "error" in json) {
            setError("error" in json ? json.error : `HTTP ${r.status}`);
          } else {
            setSource({ kind: "signal", signal: json.signal });
          }
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, inboundEmailId, signalId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const headerLabel =
    publisherDisplayName ??
    (source?.kind === "email"
      ? source.email.publisher_canonical_name
      : source?.kind === "signal"
        ? source.signal.publisher_canonical_name
        : null) ??
    "Source";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-10 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close source preview"
      />
      <div className="relative w-full max-w-[720px] bg-white border border-border rounded-lg shadow-2xl overflow-hidden">
        <div className="sticky top-0 z-10 bg-white border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
              Source
            </span>
            <span className="text-muted">·</span>
            <span className="text-sm font-medium truncate">{headerLabel}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-8 py-6">
          {loading && <div className="text-muted text-sm">Loading…</div>}
          {error && (
            <div className="text-severity-red text-sm">
              Failed to load source: {error}
            </div>
          )}
          {source?.kind === "email" && <EmailBody email={source.email} />}
          {source?.kind === "signal" && (
            <SignalBody signal={source.signal} />
          )}
          {(source || error) && sourceUrl && (
            <div className="pt-5 mt-5 border-t border-border text-xs">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                Open at publisher ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmailBody({ email }: { email: RawEmail }) {
  return (
    <>
      <div className="space-y-2 pb-5 border-b border-border">
        <h1 className="text-2xl font-semibold tracking-tight leading-snug">
          {email.subject ?? "(no subject)"}
        </h1>
        <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
          <span>
            Received{" "}
            {new Date(email.received_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span>·</span>
          <span className="font-mono text-[11px] break-all">
            {email.from_address}
          </span>
        </div>
      </div>
      <div className="pt-5">
        {email.html_body && email.html_body.trim().length > 0 ? (
          <iframe
            sandbox=""
            srcDoc={email.html_body}
            className="w-full h-[720px] border border-border rounded bg-white"
            title="Source content"
          />
        ) : email.text_body && email.text_body.trim().length > 0 ? (
          <div className="text-[15px] leading-7 whitespace-pre-wrap text-foreground/90 font-sans">
            {email.text_body}
          </div>
        ) : (
          <div className="text-muted text-sm italic">
            (No body stored for this source.)
          </div>
        )}
      </div>
    </>
  );
}

function SignalBody({ signal }: { signal: SignalSource }) {
  const title = signal.email_subject ?? signal.summary;
  return (
    <>
      <div className="space-y-2 pb-5 border-b border-border">
        <h1 className="text-2xl font-semibold tracking-tight leading-snug">
          {title}
        </h1>
        <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
          <span>
            Captured{" "}
            {new Date(signal.occurred_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          {signal.source_content_kind && (
            <>
              <span>·</span>
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {signal.source_content_kind.replace(/_/g, " ")}
              </span>
            </>
          )}
          {signal.source && (
            <>
              <span>·</span>
              <span className="text-[11px] text-muted">
                Retrieved via{" "}
                <span className="font-medium text-foreground">
                  {SOURCE_DISPLAY[signal.source] ?? signal.source}
                </span>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="pt-5">
        <MarkdownBody content={signal.source_content_md} />
      </div>
    </>
  );
}
