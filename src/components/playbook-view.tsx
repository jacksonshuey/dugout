import type { Playbook } from "@/data/playbooks";

// Pure render component for a playbook. Phases stack vertically. Branch
// phases render as side-by-side cards.

export function PlaybookView({ playbook }: { playbook: Playbook }) {
  return (
    <div className="rounded-xl border border-border bg-slate-50/50 p-5 space-y-5">
      <div className="flex items-start gap-3">
        <div className="text-[10px] font-semibold tracking-wider uppercase text-brand mt-1">
          Playbook
        </div>
        <div className="flex-1 space-y-1">
          <div className="font-semibold text-base">{playbook.title}</div>
          <p className="text-sm text-muted leading-relaxed">{playbook.context}</p>
        </div>
      </div>

      <div className="space-y-4">
        {playbook.phases.map((phase, i) => (
          <div key={phase.name} className="space-y-2">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <span className="font-semibold text-sm">{phase.name}</span>
              <span className="text-xs text-muted">· {phase.timeframe}</span>
            </div>
            <p className="text-sm text-muted leading-relaxed pl-8">{phase.summary}</p>

            {phase.steps && (
              <ul className="pl-8 space-y-1.5">
                {phase.steps.map((step, j) => (
                  <li key={j} className="flex gap-2 text-sm leading-relaxed">
                    <span className="text-muted font-mono shrink-0 mt-0.5">{j + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            )}

            {phase.branches && (
              <div className="pl-8 grid md:grid-cols-2 gap-3 pt-2">
                {phase.branches.map((branch) => (
                  <div
                    key={branch.label}
                    className="rounded-lg border border-border bg-background p-4 space-y-2"
                  >
                    <div className="font-medium text-sm">{branch.label}</div>
                    <p className="text-xs text-muted leading-relaxed">
                      {branch.description}
                    </p>
                    <ul className="space-y-1 pt-1">
                      {branch.steps.map((step, k) => (
                        <li key={k} className="flex gap-2 text-xs leading-relaxed">
                          <span className="text-muted font-mono shrink-0">{k + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
