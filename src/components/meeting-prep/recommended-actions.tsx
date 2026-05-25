import { Card } from "@/components/ui";
import type { MeetingBrief } from "@/lib/meeting-prep";

// Numbered list of actions consolidated from the blocking signals + the
// committee gap prescriptions. Severity order: blocking signals first,
// then committee gaps, then any other follow-ups.

export function RecommendedActions({ brief }: { brief: MeetingBrief }) {
  const actions: string[] = [];

  for (const sig of brief.blockingSignals) {
    actions.push(sig.suggestedAction);
  }

  if (brief.openOpportunities.length > 0) {
    const lead = brief.openOpportunities[0];
    // If the deal is past benchmark, flag it (cheap derived action).
    if (lead.daysInStage >= 21) {
      actions.push(
        `Name the blocker on ${lead.name} (${lead.daysInStage} days in ${lead.stage}) — schedule a 15-min sync with the champion.`,
      );
    }
  }

  if (actions.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <SectionHeading
        label="Recommended actions"
        sub="Severity-ordered, lifted from active signals"
      />
      <Card className="px-4 py-3">
        <ol className="space-y-2 list-decimal list-inside marker:text-muted marker:font-mono marker:text-xs">
          {actions.map((a, i) => (
            <li key={i} className="text-sm pl-1">
              {a}
            </li>
          ))}
        </ol>
      </Card>
    </section>
  );
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
