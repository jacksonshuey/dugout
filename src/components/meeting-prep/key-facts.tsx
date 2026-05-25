import { Card } from "@/components/ui";
import type { MeetingBrief } from "@/lib/meeting-prep";

// Skimmable key facts: strategic focus, recent funding, industry/HQ.
// Each card is a single line - the AE shouldn't be reading paragraphs
// 30 seconds before a meeting.

export function KeyFacts({ brief }: { brief: MeetingBrief }) {
  const items: { label: string; value: string }[] = [];

  if (brief.strategicFocus) {
    items.push({ label: "Strategic focus", value: brief.strategicFocus });
  }
  if (brief.recentFunding) {
    const parts = [brief.recentFunding.amount];
    if (brief.recentFunding.leadInvestor) {
      parts.push(`led by ${brief.recentFunding.leadInvestor}`);
    }
    if (brief.recentFunding.date) {
      parts.push(brief.recentFunding.date);
    }
    items.push({ label: "Recent funding", value: parts.join(" · ") });
  }
  if (brief.industry) {
    items.push({ label: "Industry", value: brief.industry });
  }
  if (brief.hqLocation) {
    items.push({ label: "HQ", value: brief.hqLocation });
  }

  if (items.length === 0 && brief.recentExecChanges.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <SectionHeading label="Key facts" />
      <Card className="px-4 py-3 divide-y divide-border">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted w-32 shrink-0">
              {it.label}
            </div>
            <div className="text-sm">{it.value}</div>
          </div>
        ))}
        {brief.recentExecChanges.length > 0 && (
          <div className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted w-32 shrink-0">
              Exec changes
            </div>
            <ul className="text-sm space-y-1">
              {brief.recentExecChanges.map((ec, i) => (
                <li key={`${ec.name}-${i}`}>
                  <span className="font-medium">{ec.name}</span>
                  <span className="text-muted"> - {ec.role}</span>
                  <span className="text-muted"> ({ec.change}</span>
                  {ec.date && (
                    <span className="text-muted">, {ec.date.slice(0, 10)}</span>
                  )}
                  <span className="text-muted">)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {brief.keyRisks.length > 0 && (
          <div className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
            <div className="text-[10px] uppercase tracking-wider font-mono text-muted w-32 shrink-0">
              Risks to know
            </div>
            <ul className="text-sm space-y-1 list-disc list-inside marker:text-muted">
              {brief.keyRisks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </section>
  );
}

function SectionHeading({ label }: { label: string }) {
  return (
    <h2 className="text-xs uppercase tracking-wider font-semibold text-muted font-mono">
      {label}
    </h2>
  );
}
