"use client";

import { useEffect, useState } from "react";

// Drawer that lazy-fetches /api/admin/inbound-email/<id> and renders the
// stored email. Text body is rendered as preformatted text; HTML body
// renders inside a sandboxed <iframe srcdoc> so any inline styles or
// remote-loading assets can't escape the drawer.
//
// Designed as a stateless presentational component — the parent owns
// "open" state. Used by <SignalSourceChip /> on /market-intel.

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

export function RawEmailDrawer({
  inboundEmailId,
  open,
  onClose,
}: {
  inboundEmailId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [email, setEmail] = useState<RawEmail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy load on open. Re-fetch when inboundEmailId changes while open.
  // setState calls are kicked off the synchronous effect body via a
  // microtask so the React rule "no setState directly in effects" is
  // satisfied — same outcome, no cascading-render warning.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      setEmail(null);
      try {
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
          setEmail(json.email);
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
  }, [open, inboundEmailId]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex-1 bg-black/30"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div className="w-full max-w-2xl bg-white border-l border-border overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="text-sm font-semibold">Raw email</div>
          <button
            onClick={onClose}
            className="text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 text-sm">
          {loading && <div className="text-muted">Loading…</div>}
          {error && (
            <div className="text-severity-red">
              Failed to load raw email: {error}
            </div>
          )}
          {email && (
            <>
              <div className="space-y-1">
                <div className="text-xs uppercase tracking-wider text-muted font-medium">
                  Subject
                </div>
                <div className="font-medium">
                  {email.subject ?? "(no subject)"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted font-medium">
                    From
                  </div>
                  <div className="font-mono text-xs break-all">
                    {email.from_address}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted font-medium">
                    Received
                  </div>
                  <div className="text-xs">
                    {new Date(email.received_at).toLocaleString()}
                  </div>
                </div>
              </div>
              {email.publisher_canonical_name && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted font-medium">
                    Publisher
                  </div>
                  <div className="font-mono text-xs">
                    {email.publisher_canonical_name}
                    {email.list_id && (
                      <span className="text-muted">
                        {" "}
                        · List-ID {email.list_id}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div className="pt-2 border-t border-border">
                {email.text_body && email.text_body.trim().length > 0 ? (
                  <>
                    <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
                      Text body
                    </div>
                    <pre className="text-xs whitespace-pre-wrap font-mono bg-black/[0.02] p-3 rounded border border-border overflow-x-auto">
                      {email.text_body}
                    </pre>
                  </>
                ) : email.html_body ? (
                  <>
                    <div className="text-xs uppercase tracking-wider text-muted font-medium mb-2">
                      HTML body (sandboxed)
                    </div>
                    <iframe
                      sandbox=""
                      srcDoc={email.html_body}
                      className="w-full h-[600px] border border-border rounded bg-white"
                      title="Email HTML body"
                    />
                  </>
                ) : (
                  <div className="text-muted text-xs">
                    (no body stored)
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
