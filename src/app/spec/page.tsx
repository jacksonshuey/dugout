import Link from "next/link";
import { Card } from "@/components/ui";
import { RULES } from "@/lib/signal-engine";
import { getWorkspaceConfig } from "@/lib/workspace-server";

// Single spec page. Three anchor sections: architecture, rollout, companion.
// Sticky in-page nav at the top.

export default async function SpecPage() {
  const workspace = await getWorkspaceConfig();
  const priorityById = new Map(workspace.priorities.map((p) => [p.id, p]));
  const wedgePriority = workspace.priorities[0]?.name ?? "the wedge";

  const assetByName = (id: string, fallback: string) =>
    workspace.assets.find((a) => a.id === id)?.name ?? fallback;
  const trialBrief = assetByName("outcome_first_trial_brief", "Trial Brief");
  const kpiAssessment = assetByName("kpi_assessment", "KPI Assessment");
  const preSeededDemo = assetByName("pre_seeded_demo", "Pre-Seeded Demo");
  const financeBrief = assetByName("finance_meeting_brief", "Finance Brief");
  const itPager = assetByName("it_zero_lift_one_pager", "IT One-Pager");
  const dealRoom = workspace.stack.dealRooms;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header + in-page nav */}
      <div className="space-y-3 mb-10">
        <div className="text-xs uppercase tracking-wider text-muted font-medium">
          Spec
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          How Dugout is designed and rolled out
        </h1>
        <p className="text-base text-muted max-w-2xl">
          Three sections — architecture, rollout, and a companion system. Same page; jump links below.
        </p>
        <nav className="flex flex-wrap gap-2 text-sm pt-2">
          <AnchorLink href="#architecture">Architecture</AnchorLink>
          <AnchorLink href="#rollout">Rollout</AnchorLink>
          <AnchorLink href="#companion">Companion system</AnchorLink>
          <Link
            href="/console"
            className="text-muted hover:text-foreground ml-auto"
          >
            ← Back to console
          </Link>
        </nav>
      </div>

      {/* Architecture */}
      <section id="architecture" className="scroll-mt-20 space-y-8 pb-12 border-b border-border">
        <H2>Architecture</H2>

        <Sub>Four layers — built bottom-up. Each ships only if the layer below earns trust.</Sub>

        <div className="space-y-2">
          <Layer
            n="01"
            name="Data"
            sub="Read-only ingestion."
            items={[
              `${workspace.stack.crm} — accounts, opportunities, contacts, OCR, activities`,
              `${workspace.stack.conversationIntelligence} — call transcripts + risk markers`,
              `${workspace.stack.salesEngagement} — sequence enrollment, email/call activity`,
              `${workspace.stack.dealRooms} — buyer engagement on shared assets`,
              `${workspace.stack.meetingScheduling} — meeting booking events`,
              `${workspace.stack.prospectingEnrichment} — account firmographics + buyer enrichment`,
            ]}
          />
          <Connector />
          <Layer
            n="02"
            name="Signal engine"
            sub="Pure functions over CRM state."
            items={[
              "Rules library — each rule = (id, severity, strategicPriority, evaluate fn)",
              "Deal Health — compound state weighted by close-date proximity",
              "Playbooks — multi-phase workflows attached to specific signals",
            ]}
          />
          <Connector />
          <Layer
            n="03"
            name="Orchestration"
            sub="Tasks: state, history, notes. Signals become work items, not alerts."
            items={[
              "Reconciliation — signals ⇌ tasks every render",
              "Lifecycle — open / done / snoozed / muted (with reason)",
              "Notes — AE work notes + manager coaching notes",
              "Auto-resolve — when a signal stops firing, the task closes itself + a toast surfaces it",
            ]}
          />
          <Connector />
          <Layer
            n="04"
            name="AI synthesis"
            sub="LLM only where it earns its keep."
            items={[
              "Morning digest — Claude synthesizes the briefing from signals + transcripts",
              "Sentiment + risk extraction on call transcripts (precomputed in seed)",
              "Studio v2 (deferred) — NL → runnable rule",
            ]}
          />
        </div>

        <H3>Design choices worth defending</H3>
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-5 space-y-1.5">
            <div className="font-medium">Severity is the product</div>
            <p className="text-sm text-muted leading-relaxed">
              A morning digest with 30 line items is worse than no digest. Tier dictates routing. Routing is the trust contract.
            </p>
          </Card>
          <Card className="p-5 space-y-1.5">
            <div className="font-medium">Tasks, not alerts</div>
            <p className="text-sm text-muted leading-relaxed">
              State + history is what makes this an orchestration engine instead of a notification firehose. A signal you can&apos;t close is noise.
            </p>
          </Card>
          <Card className="p-5 space-y-1.5">
            <div className="font-medium">Read-only in v1</div>
            <p className="text-sm text-muted leading-relaxed">
              We read from the CRM. We don&apos;t write back until rules have earned trust. Bad writes are unrecoverable trust losses.
            </p>
          </Card>
          <Card className="p-5 space-y-1.5">
            <div className="font-medium">LLM second</div>
            <p className="text-sm text-muted leading-relaxed">
              Deterministic rules over structured data are cheaper, faster, testable. The LLM runs on synthesis tasks, not as a general agent.
            </p>
          </Card>
        </div>

        <H3>The catalog ({RULES.length} rules)</H3>
        <div className="rounded-2xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Rule</th>
                <th className="text-left px-4 py-3 font-medium">Severity</th>
                <th className="text-left px-4 py-3 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {RULES.map((r) => {
                const p = priorityById.get(r.strategicPriority);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted mt-0.5">{r.description}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`font-mono text-xs ${r.severity === "blocking" ? "text-severity-blocking" : r.severity === "action" ? "text-severity-action" : "text-severity-awareness"}`}>
                        {r.severity.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs font-mono text-muted">
                      {r.strategicPriority}
                      {p ? ` · ${p.name}` : " (orphan)"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {workspace.priorities
          .filter((p) => !RULES.some((r) => r.strategicPriority === p.id))
          .map((p) => (
            <p key={p.id} className="text-xs text-muted leading-relaxed">
              <span className="font-mono">{p.id}</span> · {p.name} has no rules in v1 — on the rollout, not the architecture.
            </p>
          ))}

        <H3>What we don&apos;t build in v1</H3>
        <ul className="space-y-2 text-sm text-muted">
          <Bullet>Black-box deal-health scores (0–100). Named signals survive contact with reality; composite scores don&apos;t.</Bullet>
          <Bullet>Auto-writes to the CRM. We earn the write before we take it.</Bullet>
          <Bullet>Real-time everything. Morning digest is the right cadence for ~90% of signals. Real-time exists for the 10% that page.</Bullet>
          <Bullet>Predictions. &ldquo;67% chance to close&rdquo; gets quoted in forecasts and held against the system when wrong. Stick to verifiable facts.</Bullet>
        </ul>
      </section>

      {/* Rollout */}
      <section id="rollout" className="scroll-mt-20 space-y-8 py-12 border-b border-border">
        <H2>Rollout</H2>
        <Sub>Three phases. The first one decides if the rest happen.</Sub>

        <Phase
          title="Phase 1 · Weeks 1–3 — Win the wedge"
          summary="3 signals. 1 surface. 1 pod."
          scope={[
            `3 signals only, all mapped to ${wedgePriority}.`,
            "1 surface: daily Slack DM to the AE. No console, no manager view.",
            "1 pod: 3 AEs chosen for trust, not for need.",
          ]}
          metrics={[
            "Leading: % of late-stage deals with the missing stakeholder added — target +30 pts in 6 weeks.",
            "Trust: signal mute rate < 10%, action rate > 50%.",
            "Lagging (8-week look): conversion at the wedge stage vs control — target +10 pts.",
          ]}
        />

        <Phase
          title="Phase 2 · Weeks 4–8 — Earn the digest"
          summary="Console + manager view + Studio v0."
          scope={[
            "Expand the rule library to the full v1 catalog.",
            "Ship the unified console with the full morning digest.",
            "Ship Manager view for one pilot pod.",
            "Ship Studio v0 (RevOps-only).",
            "Roll out to all AEs.",
          ]}
          metrics={[
            "Adoption: digest open rate > 80% within 3 days for each new AE.",
            "Adoption: action-taken-within-72-hours on top-3 signals > 50%.",
            "Studio: ≥ 5 rules authored via Studio in 4 weeks.",
            "Lagging: AE time-in-CRM down 20%, time-in-customer-conversations up.",
          ]}
        />

        <Phase
          title="Phase 3 · Weeks 9–12 — Compound the loop"
          summary="Cross-deal patterns + ABM signals + feedback flywheel."
          scope={[
            "Open Studio to managers — codify questions instead of repeating them.",
            "Cross-deal pattern signals: champion-changing-jobs, competitor mention clusters.",
            "Account-level ABM signals — intent scoring, multi-deal aggregation.",
            "Feedback dashboard — low action-rate rules auto-flag for review.",
            "Begin selective write-back scoping.",
          ]}
          metrics={[
            "Rule velocity: 2+ shipped per week, < 1 deprecated per week.",
            "Compounding adoption: action-rate increases over time.",
            "Lagging: win-rate uplift on Eval+ deals where ≥ 2 recommended actions were taken.",
          ]}
        />

        <H3>The single metric I&apos;d defend in the boardroom</H3>
        <Card className="p-6 space-y-2">
          <div className="font-semibold">
            % of late-stage deals with the missing stakeholder role added within 7 days of the signal firing.
          </div>
          <p className="text-muted leading-relaxed text-sm">
            Cleanest proxy for whether the system is changing behavior at the workspace&apos;s named kill point ({workspace.killPoint}). Instrumented in the CRM already. Leading indicator for the lagging metric that matters: conversion through the kill zone.
          </p>
        </Card>
      </section>

      {/* Companion system */}
      <section id="companion" className="scroll-mt-20 space-y-8 pt-12">
        <H2>Companion system: Trial Orchestrator</H2>
        <Sub>The signal engine surfaces &ldquo;deploy a trial.&rdquo; This companion removes every step between that decision and the trial being live in 48 hours.</Sub>

        <H3>The system in 6 steps</H3>
        <Card className="p-6 space-y-2 text-sm leading-relaxed">
          <Step n="01" title="Trigger" body={`AE clicks "Start Trial" on an Eval opp. Auto-fires when the signal engine raises a no-trial-brief warning.`} />
          <Step n="02" title="Intake (5 min, AE)" body="Auto-prefilled form pulls account, champion, recent call summaries, deal-room engagement. AE confirms 3 KPIs." />
          <Step n="03" title="SE assignment + clock" body="Round-robin by segment + load. 48-hour SLA, visible to AE, SE, and manager." />
          <Step n="04" title={`${kpiAssessment} + ${preSeededDemo} (SE, ≤ 48h)`} body={`SE builds the assessment, seeds the demo with the buyer's scenarios, drops both into a ${dealRoom} room.`} />
          <Step n="05" title="Champion enablement package (auto)" body={`${dealRoom} auto-populates: ${kpiAssessment}, ${preSeededDemo}, ${financeBrief}, ${itPager}, similar customer story, ~90s AI-generated walkthrough video.`} />
          <Step n="06" title="Champion notification (auto)" body={`Email + Slack to champion. Engagement tracked back to the deal in ${workspace.stack.crm}.`} />
        </Card>

        <H3>Why it compounds with the rest of the intelligence layer</H3>
        <ul className="space-y-2 text-sm text-muted">
          <Bullet>Signal detects the gap. Orchestrator removes the work between detection and delivery. Together: &ldquo;we should run a trial&rdquo; → &ldquo;trial is live&rdquo; in two days.</Bullet>
          <Bullet>Operationalizes existing assets ({trialBrief}, {financeBrief}, {itPager}) at the moment they matter.</Bullet>
          <Bullet>Cheap to ship: CRM flow + cron jobs + deal-room API + one prompt. ~3 sprint weeks.</Bullet>
        </ul>

        <H3>Measurement (4-week pilot)</H3>
        <Card className="p-6 text-sm space-y-2">
          <Row label="Trial-deploy lead time" value="~6 business days → ≤ 48 business hours on 80% of triggered trials" />
          <Row label="Trial deployment rate" value="~35% of Eval deals → 90% in 8 weeks" />
          <Row label="Trial → won conversion" value="Hold steady at 3× the trial volume — proves quality isn't degrading" />
          <Row label="SE utilization" value="Past 80%, that's the data to justify SE #3" />
        </Card>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function AnchorLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="px-3 py-1 rounded-md text-foreground border border-border hover:border-brand hover:text-brand transition-colors"
    >
      {children}
    </a>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-2xl font-semibold tracking-tight">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold tracking-tight mt-6">{children}</h3>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <p className="text-muted leading-relaxed max-w-2xl">{children}</p>;
}

function Layer({
  n,
  name,
  sub,
  items,
}: {
  n: string;
  name: string;
  sub: string;
  items: string[];
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-5">
        <div className="text-xs font-mono text-muted shrink-0 mt-1">{n}</div>
        <div className="flex-1 space-y-2">
          <div>
            <div className="text-base font-semibold">{name}</div>
            <div className="text-sm text-muted">{sub}</div>
          </div>
          <ul className="space-y-1 text-sm">
            {items.map((i) => (
              <li key={i} className="flex gap-2 text-muted">
                <span>•</span>
                <span>{i}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function Connector() {
  return (
    <div className="flex justify-center">
      <div className="w-px h-4 bg-border" />
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2 leading-relaxed">
      <span className="text-foreground">•</span>
      <span>{children}</span>
    </li>
  );
}

function Phase({
  title,
  summary,
  scope,
  metrics,
}: {
  title: string;
  summary: string;
  scope: string[];
  metrics: string[];
}) {
  return (
    <Card className="p-6 space-y-4">
      <div>
        <div className="text-base font-semibold">{title}</div>
        <div className="text-sm text-muted mt-0.5">{summary}</div>
      </div>
      <div className="space-y-3">
        <PhaseBlock label="Scope" items={scope} />
        <PhaseBlock label="Metrics" items={metrics} />
      </div>
    </Card>
  );
}

function PhaseBlock({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="space-y-1.5">
      <div className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wider bg-brand/10 text-brand">
        {label.toUpperCase()}
      </div>
      <ul className="space-y-1 text-sm text-muted">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <span className="text-foreground">•</span>
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-border last:border-0">
      <div className="text-xs font-mono text-muted shrink-0 mt-0.5">{n}</div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-muted leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2 border-b border-border last:border-0">
      <div className="font-medium shrink-0">{label}</div>
      <div className="text-muted text-right">{value}</div>
    </div>
  );
}
