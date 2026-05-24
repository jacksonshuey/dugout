import Link from "next/link";
import { Card } from "@/components/ui";
import {
  getRecentInboundEmails,
  type InboundEmail,
} from "@/lib/inbound-email";

// Hidden inbox view — no nav link. Reach via /inbox direct URL.
//
// Renders the raw HTML/text bodies of inbound emails so a human can read
// what landed (clicking newsletter confirmation links, scanning subjects)
// without needing to query Supabase by hand. Complementary to /market-intel,
// which surfaces the *classifier's output*; this surfaces the *input*.
//
// Each body renders inside a sandboxed iframe with srcDoc, so any scripts
// or forms in newsletter HTML can't run against this app's origin. Popups
// are permitted so confirmation links can open in a new browser tab.

export const dynamic = "force-dynamic";

const INBOX_LIMIT = 50;

export default async function InboxPage() {
  let emails: InboundEmail[] = [];
  let fetchError: string | null = null;
  try {
    emails = await getRecentInboundEmails(INBOX_LIMIT);
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Header />
      {fetchError ? (
        <Card className="p-6 text-sm space-y-2">
          <div className="font-medium">Supabase unreachable</div>
          <div className="text-muted">
            The <code>inbound_emails</code> read failed. If you haven&apos;t
            set up the newsletter inbox yet, run{" "}
            <code>supabase/migrations/20260522_inbound_emails.sql</code> in
            Supabase Studio and configure <code>SUPABASE_URL</code> /{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </div>
          <div className="font-mono text-xs text-muted pt-1 break-all">
            {fetchError}
          </div>
        </Card>
      ) : emails.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {emails.map((email) => (
            <li key={email.id}>
              <EmailRow email={email} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-3 mb-8">
      <div className="text-xs uppercase tracking-wider text-muted font-medium">
        Inbox · hidden
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Raw inbox</h1>
      <p className="text-base text-muted max-w-2xl">
        Last {INBOX_LIMIT} inbound newsletter emails.
        Click a row to expand and view the email body — links inside open in
        new tabs. Reached by direct URL only; no nav link.
      </p>
      <div className="text-sm pt-2">
        <Link href="/" className="text-muted hover:text-foreground">
          ← Back to console
        </Link>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="p-6 text-sm space-y-2">
      <div className="font-medium">No inbound mail yet</div>
      <div className="text-muted">
        Once a newsletter sends to your <code>inbox.&lt;your-domain&gt;</code>{" "}
        address, it&apos;ll appear here.
      </div>
    </Card>
  );
}

function EmailRow({ email }: { email: InboundEmail }) {
  const fallback = email.text_body
    ? `<pre style="white-space: pre-wrap; font-family: ui-monospace, monospace; padding: 16px; margin: 0;">${escapeHtml(email.text_body)}</pre>`
    : `<p style="padding: 16px; color: #888;">(no body content)</p>`;
  const body = email.html_body || fallback;

  return (
    <Card className="overflow-hidden">
      <details className="group">
        <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-3 hover:bg-black/[0.02]">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {email.subject || "(no subject)"}
            </div>
            <div className="text-xs text-muted mt-0.5 truncate">
              {email.from_address} · {formatDate(email.received_at)}
            </div>
          </div>
          <ClassificationBadge email={email} />
          <span aria-hidden className="text-muted text-xs font-mono shrink-0">
            ▾
          </span>
        </summary>
        <div className="border-t border-border bg-black/[0.02] p-4 space-y-3">
          <iframe
            srcDoc={body}
            // Maximum lockdown: no scripts, no forms. Popups allowed so
            // newsletter "confirm subscription" links can open a normal
            // browser tab outside the sandbox.
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="w-full h-[500px] rounded border border-border bg-background"
            title={`Email body: ${email.subject ?? "(no subject)"}`}
          />
          <Meta email={email} />
        </div>
      </details>
    </Card>
  );
}

function ClassificationBadge({ email }: { email: InboundEmail }) {
  const label = !email.classified_at
    ? "Pending"
    : `${email.signals_emitted} signal${email.signals_emitted === 1 ? "" : "s"}`;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider border border-border bg-black/[0.04] shrink-0">
      {label}
    </span>
  );
}

function Meta({ email }: { email: InboundEmail }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs text-muted">
      <dt>Message-ID</dt>
      <dd className="font-mono break-all text-foreground">
        {email.message_id ?? "—"}
      </dd>
      <dt>Size</dt>
      <dd className="text-foreground">
        {(email.raw_size_bytes / 1024).toFixed(1)} KB
      </dd>
      <dt>Classified</dt>
      <dd className="text-foreground">
        {email.classified_at ? formatDate(email.classified_at) : "—"}
      </dd>
    </dl>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
