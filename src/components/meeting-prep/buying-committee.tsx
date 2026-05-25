import { Card } from "@/components/ui";
import type { MeetingBrief } from "@/lib/meeting-prep";

// Buying-committee snapshot. Shows mapped count + each gap with a
// short prescription so the AE knows what to ask about in the meeting.

const GAP_PRESCRIPTIONS: Record<string, string> = {
  Champion: "Identify a champion this week - without one the deal won't progress.",
  "Executive Sponsor":
    "Ask the champion for an EB intro before the next milestone - exec sign-off can't be last-minute.",
  Finance:
    "Map a Finance contact before the next buyer meeting - budget approval is the canonical kill point.",
  "IT/Security":
    "Get IT involved now - security reviews average 2-4 weeks and gate Contracting.",
  Legal:
    "Loop in Legal early to head off MSA red-line surprises.",
  Procurement:
    "Get Procurement scoped before paperwork lands - saves weeks of triage.",
};

export function BuyingCommittee({
  committee,
}: {
  committee: MeetingBrief["buyingCommittee"];
}) {
  return (
    <section className="space-y-2">
      <SectionHeading
        label="Buying committee"
        sub={`${committee.mapped} mapped · ${committee.gaps.length} gap${committee.gaps.length === 1 ? "" : "s"}`}
      />
      <Card className="px-4 py-3 space-y-3">
        {committee.gaps.length === 0 ? (
          <div className="text-sm text-muted italic">
            All required roles are on the OCR.
          </div>
        ) : (
          <ul className="space-y-2">
            {committee.gaps.map((g) => (
              <li key={g} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 border border-amber-500/30">
                    Missing
                  </span>
                  <span className="font-medium">{g}</span>
                </div>
                {GAP_PRESCRIPTIONS[g] && (
                  <div className="text-[13px] text-muted leading-snug pl-[68px]">
                    {GAP_PRESCRIPTIONS[g]}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
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
