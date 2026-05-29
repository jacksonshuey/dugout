"use client";

import { useEffect, useState } from "react";
import type { ExternalSignal } from "@/lib/external-signals";

// Right-rail panel that renders the source email a bullet was extracted from.
// Lazy-loads /api/admin/inbound-email/[id] only when a bullet is selected so
// the inbox initial render is a single Supabase query, not N email fetches.

interface EmailRow {
  id: string;
  subject: string | null;
  from_address: string | null;
  from_domain: string | null;
  received_at: string;
  text_body: string | null;
  html_body: string | null;
  list_id: string | null;
  publisher_canonical_name: string | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; email: EmailRow }
  | { kind: "error"; message: string }
  | { kind: "unauthorized" };

interface SourceEmailPanelProps {
  // Either drive the panel from a clicked bullet (shows the extracted bullet
  // header above the email), or from a recall search hit (just the email).
  bullet?: ExternalSignal | null;
  emailId?: string | null;
}

export function SourceEmailPanel({ bullet, emailId: emailIdProp }: SourceEmailPanelProps) {
  const emailId = emailIdProp ?? bullet?.inbound_email_id ?? null;
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    // No emailId → the render early-return below handles the empty UI; we
    // don't touch state. This avoids set-state-in-effect lint warning + a
    // useless re-render on each clear.
    if (!emailId) return;
    let cancelled = false;
    // Marking loading at fetch start is the canonical "show spinner while we
    // wait" pattern. The lint rule prefers deriving loading from refs; the
    // alternative is more code without behavioral benefit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading" });
    fetch(`/api/admin/inbound-email/${encodeURIComponent(emailId)}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) {
          setState({ kind: "unauthorized" });
          return;
        }
        if (!res.ok) {
          setState({
            kind: "error",
            message: `lookup failed (${res.status})`,
          });
          return;
        }
        const json = (await res.json()) as { email?: EmailRow; error?: string };
        if (!json.email) {
          setState({ kind: "error", message: json.error ?? "no payload" });
          return;
        }
        setState({ kind: "ready", email: json.email });
      })
      .catch((e) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [emailId]);

  if (!emailId && !bullet) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-foreground/[0.015] p-6 text-sm text-muted">
        Pick a bullet or search the recall index to see a newsletter.
      </div>
    );
  }

  if (!emailId && bullet) {
    return (
      <div className="rounded-lg border border-border bg-background p-6 text-sm">
        <div className="text-xs uppercase tracking-[0.1em] font-mono text-muted">
          No source email
        </div>
        <div className="mt-2 text-foreground/80">{bullet.summary}</div>
        <div className="mt-3 text-xs text-muted">
          This bullet didn&apos;t come from an inbound email (likely a SEC
          filing or seeded row).
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {state.kind === "loading" && <PanelLoading bullet={bullet ?? null} />}
      {state.kind === "error" && (
        <PanelError bullet={bullet ?? null} message={state.message} />
      )}
      {state.kind === "unauthorized" && (
        <PanelUnauthorized bullet={bullet ?? null} />
      )}
      {state.kind === "ready" && (
        <EmailReader email={state.email} bullet={bullet ?? null} />
      )}
      {state.kind === "idle" && <PanelLoading bullet={bullet ?? null} />}
    </div>
  );
}

function PanelLoading({ bullet }: { bullet: ExternalSignal | null }) {
  return (
    <div className="p-6 text-sm">
      {bullet && <BulletHeader bullet={bullet} />}
      <div className={bullet ? "mt-4 text-muted" : "text-muted"}>
        Loading source email…
      </div>
    </div>
  );
}

function PanelError({
  bullet,
  message,
}: {
  bullet: ExternalSignal | null;
  message: string;
}) {
  return (
    <div className="p-6 text-sm">
      {bullet && <BulletHeader bullet={bullet} />}
      <div className={bullet ? "mt-4 text-foreground/80" : "text-foreground/80"}>
        Source email unavailable.
      </div>
      <div className="mt-1 text-xs text-muted font-mono">{message}</div>
    </div>
  );
}

function PanelUnauthorized({ bullet }: { bullet: ExternalSignal | null }) {
  return (
    <div className="p-6 text-sm">
      {bullet && <BulletHeader bullet={bullet} />}
      <div className={bullet ? "mt-4 text-foreground/80" : "text-foreground/80"}>
        Sign in to view the source newsletter.
      </div>
      <div className="mt-1 text-xs text-muted">
        The raw email lives behind the UI session cookie.
      </div>
    </div>
  );
}

function BulletHeader({ bullet }: { bullet: ExternalSignal }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] font-mono text-muted">
        Bullet
      </div>
      <div className="mt-1 text-sm font-medium leading-snug">
        {bullet.summary}
      </div>
    </div>
  );
}

function EmailReader({
  email,
  bullet,
}: {
  email: EmailRow;
  bullet: ExternalSignal | null;
}) {
  // Prefer text_body for readability; fall back to a HTML→text strip so we
  // always render something. The full HTML is intentionally NOT injected
  // (XSS surface, brand-foreign styles); operators who need the rendered
  // HTML can open the admin endpoint directly.
  const body = email.text_body ?? stripHtml(email.html_body ?? "");
  return (
    <div>
      <div className="px-5 py-4 border-b border-border bg-foreground/[0.02]">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-xs uppercase tracking-[0.1em] font-mono text-muted">
            Source newsletter
          </div>
          <div className="text-[11px] font-mono text-muted">
            {formatDate(email.received_at)}
          </div>
        </div>
        <div className="mt-2 text-sm font-semibold tracking-tight leading-snug">
          {email.subject || "(no subject)"}
        </div>
        <div className="mt-1 text-xs text-muted">
          From{" "}
          <span className="text-foreground/80">
            {email.publisher_canonical_name ||
              email.from_address ||
              email.from_domain ||
              "unknown"}
          </span>
        </div>
      </div>
      <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
        {bullet && (
          <>
            <div className="text-[11px] uppercase tracking-[0.1em] font-mono text-brand/80">
              Extracted bullet
            </div>
            <div className="mt-1 text-sm leading-snug">{bullet.summary}</div>
            <div className="mt-5 text-[11px] uppercase tracking-[0.1em] font-mono text-muted">
              Body
            </div>
          </>
        )}
        {!bullet && (
          <div className="text-[11px] uppercase tracking-[0.1em] font-mono text-muted">
            Body
          </div>
        )}
        <pre className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80 font-sans">
          {body || "(empty)"}
        </pre>
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
