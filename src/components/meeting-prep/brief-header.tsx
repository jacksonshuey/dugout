import type { MeetingBrief } from "@/lib/meeting-prep";

// Top hero band on /account/[slug]/prep. Shows the account name, the
// one-line company descriptor (from web-scrape brief_fields when present),
// the SV Health badge, and a freshness chip so the AE knows how recently
// the scrape data was refreshed before the meeting.

function freshnessLabel(brief: Pick<MeetingBrief, "scrapeStatus" | "lastCrawledAt">): {
  text: string;
  cls: string;
} {
  switch (brief.scrapeStatus) {
    case "fresh":
      return {
        text: brief.lastCrawledAt
          ? `Fresh · updated ${relativeFromNow(brief.lastCrawledAt)}`
          : "Fresh",
        cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
      };
    case "stale":
      return {
        text: brief.lastCrawledAt
          ? `Stale · updated ${relativeFromNow(brief.lastCrawledAt)}`
          : "Stale",
        cls: "border-amber-500/30 bg-amber-500/10 text-amber-700",
      };
    case "pending":
      return {
        text: "Pending · crawling now, try again in ~60s",
        cls: "border-slate-400/30 bg-slate-100 text-slate-700",
      };
    case "missing":
      return {
        text: "No website on file",
        cls: "border-red-500/30 bg-red-500/10 text-red-700",
      };
  }
}

function relativeFromNow(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "recently";
  const hours = (Date.now() - t) / (60 * 60 * 1000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function tierClass(tier: "HEALTHY" | "WATCH" | "CRITICAL"): string {
  if (tier === "HEALTHY") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700";
  }
  if (tier === "WATCH") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  }
  return "border-red-500/40 bg-red-500/10 text-red-700";
}

export function BriefHeader({ brief }: { brief: MeetingBrief }) {
  const freshness = freshnessLabel(brief);
  return (
    <header className="rounded-2xl bg-brand text-white px-6 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-2 min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">
            Pre-meeting brief
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {brief.accountName}
          </h1>
          {brief.companyOneLiner && (
            <p className="text-sm text-white/85 max-w-2xl leading-snug">
              {brief.companyOneLiner}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider uppercase border ${freshness.cls}`}
            >
              {freshness.text}
            </span>
            {brief.industry && (
              <span className="text-[11px] text-white/75">
                {brief.industry}
              </span>
            )}
            {brief.hqLocation && (
              <span className="text-[11px] text-white/75">
                · {brief.hqLocation}
              </span>
            )}
          </div>
        </div>
        {brief.svHealth && (
          <div className="text-right space-y-1 shrink-0">
            <div className="text-[10px] uppercase tracking-wider font-mono opacity-80">
              SV Health
            </div>
            <div className="text-3xl font-semibold tabular-nums">
              {brief.svHealth.score}
              <span className="text-base text-white/70"> / 100</span>
            </div>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase border ${tierClass(brief.svHealth.tier)}`}
            >
              {brief.svHealth.tier}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
