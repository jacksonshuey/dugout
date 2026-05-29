import type { Metadata } from "next";
import { InboxView } from "@/components/inbox/inbox-view";
import { getInboxBullets, WORKSPACE_ACCOUNT_ID } from "@/lib/external-signals";
import { accounts } from "@/data/seed";
import { LEGACY_ACCOUNT_ALIASES } from "@/data/legacy-account-aliases";

// /inbox — the news inbox.
//
// Left rail: chronological bullet stream (events extracted from newsletters
// by the AgentMail webhook → Stage1/Stage2 filter → Haiku classifier chain).
// Tracked-account hits sort before workspace-pool bullets; impact_score breaks
// ties. The same source data the landing "Top news of the week" feed uses,
// but unfiltered (inbox_only bullets included).
//
// Right rail: the source email itself, lazy-loaded via the existing
// /api/admin/inbound-email/[id] route. Reads like a real email — from,
// subject, date, body — so the operator can verify the bullet against the
// derivation source.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Inbox · Dugout",
  description:
    "Live newsletter bullets, ranked by tracked-account mentions and AI magnitude.",
};

const INBOX_LIMIT = 100;
const INBOX_LOOKBACK_DAYS = 14;

export default async function InboxPage() {
  let bullets: Awaited<ReturnType<typeof getInboxBullets>> = [];
  let loadError: string | null = null;
  try {
    bullets = await getInboxBullets(INBOX_LOOKBACK_DAYS, INBOX_LIMIT);
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }

  const accountNameById = new Map<string, string>([
    ...accounts.map((a): [string, string] => [a.id, a.name]),
    ...Object.entries(LEGACY_ACCOUNT_ALIASES),
  ]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-12 sm:py-16">
      <header className="mb-6">
        <p className="text-[10px] uppercase tracking-[0.18em] font-mono text-muted">
          → News inbox
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight">
          Every fact from every newsletter.
        </h1>
        <p className="mt-3 text-base text-foreground/70 leading-relaxed max-w-2xl">
          Each inbound newsletter is split into atomic bullets. Tracked-account
          mentions surface first; everything else is ranked by AI-scored
          magnitude. Click a bullet to inspect the source email it came from.
        </p>
      </header>

      <InboxView
        bullets={bullets}
        loadError={loadError}
        workspaceId={WORKSPACE_ACCOUNT_ID}
        accountNameById={Object.fromEntries(accountNameById)}
      />
    </main>
  );
}
