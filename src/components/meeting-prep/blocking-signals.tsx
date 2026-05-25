import { Card } from "@/components/ui";
import type { MeetingBrief } from "@/lib/meeting-prep";

// Blocking signals - shown first in the brief so the AE walks into the
// meeting knowing what's on fire before anything else. Red border + the
// suggested action verbatim from the signal engine.

export function BlockingSignals({
  signals,
}: {
  signals: MeetingBrief["blockingSignals"];
}) {
  if (signals.length === 0) {
    return (
      <section className="space-y-2">
        <SectionHeading
          label="Blocking signals"
          sub="The first thing your buyer will ask about"
        />
        <Card className="px-4 py-5 text-sm text-muted italic">
          No blocking signals. Deal is healthy.
        </Card>
      </section>
    );
  }
  return (
    <section className="space-y-2">
      <SectionHeading
        label="Blocking signals"
        sub={`${signals.length} active - address before the meeting`}
      />
      <div className="space-y-3">
        {signals.map((s) => (
          <article
            key={s.id}
            className="rounded-xl border-l-4 border-red-500/80 border border-red-200 bg-red-50/40 px-4 py-3 space-y-2"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-red-900">
                {s.title}
              </h3>
              <span className="text-[10px] font-semibold tracking-wider uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-700 border border-red-500/30">
                Blocking
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{s.body}</p>
            <div className="text-sm font-medium text-foreground/85 pt-1">
              <span className="text-[10px] uppercase tracking-wider font-mono text-muted mr-1.5">
                Do
              </span>
              {s.suggestedAction}
            </div>
            {s.assetLink && (
              <div className="text-[11px] text-muted font-mono pt-1">
                Asset: {s.assetLink}
              </div>
            )}
          </article>
        ))}
      </div>
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
