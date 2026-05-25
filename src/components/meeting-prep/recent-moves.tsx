import { Card } from "@/components/ui";
import type { MeetingBrief } from "@/lib/meeting-prep";

// Account-specific moves from the last 30 days. Bulleted, dated, sourced.
// Filtered upstream by buildMeetingBrief() to high/medium relevance.

export function RecentMoves({
  moves,
}: {
  moves: MeetingBrief["recentMoves"];
}) {
  if (moves.length === 0) {
    return (
      <section className="space-y-2">
        <SectionHeading
          label="Recent moves"
          sub="Last 30 days · workspace-relevant only"
        />
        <Card className="px-4 py-5 text-sm text-muted italic">
          No recent moves on this account.
        </Card>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <SectionHeading
        label="Recent moves"
        sub={`${moves.length} item${moves.length === 1 ? "" : "s"} · last 30 days`}
      />
      <Card className="divide-y divide-border">
        {moves.map((m, i) => (
          <div key={i} className="px-4 py-3 flex gap-3 items-start">
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted w-16 shrink-0 pt-0.5">
              {formatDate(m.occurredAt)}
            </div>
            <div className="text-sm flex-1 min-w-0">
              {m.url ? (
                <a
                  href={m.url}
                  className="hover:text-brand"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {m.headline}
                </a>
              ) : (
                <span>{m.headline}</span>
              )}
            </div>
            <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-slate-100 text-muted border border-border shrink-0">
              {m.source}
            </span>
          </div>
        ))}
      </Card>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SectionHeading({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xs uppercase tracking-wider font-semibold text-muted font-mono">
        {label}
      </h2>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </div>
  );
}
