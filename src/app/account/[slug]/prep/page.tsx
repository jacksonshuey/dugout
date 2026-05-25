// /account/[slug]/prep — the AE pre-meeting prep surface.
//
// Server-rendered. Reads the MeetingBrief shape via the in-process
// synthesizer (no HTTP roundtrip to /api/firecrawl/company-scope —
// BUILD_ALIGNMENT principle #7 says server components prefer lib helpers
// over self-fetch). The HTTP route exists for the Phase 6 Claude Code
// skill agent and any future external consumer.
//
// UX: minimal, scannable in 30 seconds. No client state, no carousel.
// Optional `?refresh=1` searchParam is a hint to the caller that the
// brief was just regenerated — used to inject a small toast band so the
// AE sees the freshness; otherwise the page is purely declarative.

import Link from "next/link";
import { notFound } from "next/navigation";
import { accounts as seedAccounts } from "@/data/seed";
import { listTrackableAccounts } from "@/lib/accounts";
import { buildMeetingBrief } from "@/lib/meeting-prep";
import { Card } from "@/components/ui";
import { BriefHeader } from "@/components/meeting-prep/brief-header";
import { BlockingSignals } from "@/components/meeting-prep/blocking-signals";
import { KeyFacts } from "@/components/meeting-prep/key-facts";
import { RecentMoves } from "@/components/meeting-prep/recent-moves";
import { BuyingCommittee } from "@/components/meeting-prep/buying-committee";
import { RecommendedActions } from "@/components/meeting-prep/recommended-actions";

export const dynamic = "force-dynamic";

async function accountExists(slug: string): Promise<boolean> {
  if (seedAccounts.find((a) => a.id === slug)) return true;
  try {
    const dbAccounts = await listTrackableAccounts();
    return !!dbAccounts.find((a) => a.id === slug);
  } catch {
    return false;
  }
}

export default async function MeetingPrepPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // Next 16: searchParams is async (Promise). See AGENTS.md.
  searchParams?: Promise<{ refresh?: string }>;
}) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const refreshHint = sp.refresh === "1";

  if (!(await accountExists(slug))) {
    notFound();
  }

  const brief = await buildMeetingBrief(slug);

  // Empty-state hero when there's literally no scraped data yet. The
  // brief still rendered with empty fields; we just steer the AE toward
  // patience with a friendlier message than blank cards.
  const showPendingEmptyState =
    brief.scrapeStatus === "pending" &&
    brief.recentMoves.length === 0 &&
    !brief.companyOneLiner;

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
      {/* ─── Breadcrumb ────────────────────────────────────────────── */}
      <nav className="text-xs text-muted flex items-center gap-1.5">
        <Link href="/console" className="hover:text-foreground">
          Console
        </Link>
        <span aria-hidden>›</span>
        <Link href={`/account/${slug}`} className="hover:text-foreground">
          {brief.accountName}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-foreground font-medium">Pre-meeting brief</span>
      </nav>

      {refreshHint && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700">
          Brief refreshed at {new Date(brief.generatedAt).toLocaleTimeString()}.
        </div>
      )}

      <BriefHeader brief={brief} />

      {showPendingEmptyState ? (
        <Card className="px-6 py-8 text-center space-y-3">
          <div className="text-sm font-medium">
            Crawling {brief.accountName} now — check back in ~60 seconds.
          </div>
          <p className="text-sm text-muted max-w-xl mx-auto">
            No scraped data is available yet. Hitting refresh will regenerate
            the brief once the per-account Firecrawl sweep finishes.
          </p>
          <div>
            <Link
              href={`/account/${slug}/prep?refresh=1`}
              className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-semibold border border-border bg-background hover:bg-slate-50"
            >
              Refresh
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <BlockingSignals signals={brief.blockingSignals} />
          <KeyFacts brief={brief} />
          <RecentMoves moves={brief.recentMoves} />
          <BuyingCommittee committee={brief.buyingCommittee} />
          <RecommendedActions brief={brief} />
        </>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted pt-2">
        <span>
          Generated {new Date(brief.generatedAt).toLocaleString()} ·{" "}
          {brief.scrapeStatus}
        </span>
        <Link href={`/account/${slug}`} className="hover:text-foreground">
          Open full account →
        </Link>
      </div>
    </div>
  );
}
