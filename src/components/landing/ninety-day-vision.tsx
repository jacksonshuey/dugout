import { BrandLogo, type BrandKey } from "@/components/landing/logos";
import { NinetyDayRail } from "@/components/landing/ninety-day-rail";

// 90-day vision section. Goes at the top of the landing page, right under
// the hero. The story is: "here's what Dugout becomes if I'm hired Day 1."
//
// Layout: sticky day-ruler rail on the left (client component, observes
// phase sections via IntersectionObserver), three phase cards on the right.
// Final card is the Day-90 end state.
//
// Content rules:
// - Specificity over polish. Real API names, real KPI definitions, real
//   model picks. The interview panel will probe.
// - No pricing tiers. No "Free/Pro/Enterprise" anywhere.
// - Anthropic does synthesis, OpenAI does the cheap classification +
//   voice sparkle. The split is deliberate and gets explained in line.

interface WeekSpec {
  range: string; // "Days 1-7"
  title: string;
  bullets: string[];
  ships: string; // one-line "what concretely ships"
  kpi: string;
  model?: { provider: "anthropic" | "openai"; note: string };
}

interface PhaseSpec {
  id: string; // anchor id, e.g. "phase-1"
  number: "01" | "02" | "03";
  range: string; // "Days 0-30"
  title: string;
  thesis: string;
  weeks: WeekSpec[];
  goesLive: BrandKey[];
  demoProof: string;
}

const PHASES: PhaseSpec[] = [
  {
    id: "phase-1",
    number: "01",
    range: "Days 0 – 30",
    title: "Internal truth.",
    thesis:
      "Today's Dugout reads from newsletters, news, and seed fixtures. Phase 1 rewires it to the systems where deals actually live: Salesforce, Gong, Outreach. The signal engine you've already seen, running on real CRM state.",
    weeks: [
      {
        range: "Days 1 – 7",
        title: "Salesforce read · top 20 deals",
        bullets: [
          "Salesforce Connected App, JWT Bearer OAuth — Dugout authenticates as a system identity, not per-user.",
          "Read scope: Opportunity, Account, Contact, Task, Event, OpportunityHistory, User.",
          "Bulk API 2.0 for the initial backfill of the top 20 active opportunities by ARR.",
          "Change Data Capture subscription on Opportunity + Task → Supabase sf_events audit table.",
          "Field-mapping doc committed to docs/sf-fields.md so RevOps can review what Dugout reads.",
          "Signal STAGE_AGE_EXCEEDED rewires from fixture timestamps to OpportunityHistory.CreatedDate.",
        ],
        ships: "20 of 20 active deals visible in /manager, sourced from Salesforce.",
        kpi: "Live SV Health Score on a real Checkbox deal, computed from real CRM state.",
      },
      {
        range: "Days 8 – 14",
        title: "Gong calls + transcripts",
        bullets: [
          "Gong Calls API + Transcripts API (/v2/calls, /v2/calls/transcript).",
          "Webhook subscription: new call processed → inbound_calls table → classify-pending cron.",
          "Transcripts → text-embedding-3-large → call_embeddings (pgvector, Supabase), keyed off account pkey.",
          "Haiku 4.5 does cheap per-row scoring (sentiment, topic tags). OpenAI GPT-4.1 does the ontology extraction — pulling commitments, objections, exec mentions, and next-step language into typed shapes that match Dugout's call schema.",
          "CALL_NEGATIVE_SENTIMENT now reads real calls. New rule: OBJECTION_RECURRING fires when the same extracted-objection topic surfaces in 2+ calls on one opp.",
        ],
        ships: "Every Gong call from the last 30 days indexed and decomposed into ontology rows.",
        kpi: "/ask 'what's the main objection on the Snowflake deal?' returns a cited answer from real call rows.",
        model: {
          provider: "openai",
          note: "Haiku 4.5 scores rows · GPT-4.1 extracts into ontology · embedding-3-large for retrieval",
        },
      },
      {
        range: "Days 15 – 21",
        title: "Outreach engagement",
        bullets: [
          "Outreach OAuth + Activity API + Sequence State API.",
          "Pull: prospect engagement (opens, clicks, replies) and active sequence state per opp contact.",
          "contact_mapping table joins Outreach Prospect ↔ Salesforce Contact via email — auditable.",
          "ENGAGEMENT_DECAY: opens/clicks dropped >50% week-over-week.",
          "SINGLE_THREAD_RISK now reads real contact engagement, not fixture counts.",
        ],
        ships: "Engagement decay flagged on 3+ real deals within the first week of pull.",
        kpi: "Manager dashboard shows a per-rep multithread index from Outreach data.",
      },
      {
        range: "Days 22 – 30",
        title: "Pilot gate · noise budget",
        bullets: [
          "Per-AE snooze button + reason code on every signal. Aggregate snooze rate per rule rendered to /manager/signal-health.",
          "2-AE pilot cohort begins (SVP Revenue picks them). Blocking tier only, routed via DM.",
          "Weekly tuning loop documented: any rule >40% snooze rate gets retuned or killed.",
          "First rule killed publicly. The proof that judgment, not output, is what we're optimizing for.",
        ],
        ships: "Documented noise budget. First rule retired on data.",
        kpi: "Pilot AE snooze rate <40% on the Blocking tier by Day 30.",
      },
    ],
    goesLive: ["salesforce", "gong", "outreach"],
    demoProof:
      "End of Phase 1: SV Health Score on a real Checkbox deal, semantic search across real Gong calls, multithread risk computed from real Outreach data. Three real integrations, one killed rule, two AEs in the loop.",
  },
  {
    id: "phase-2",
    number: "02",
    range: "Days 31 – 60",
    title: "Stakeholder enablement.",
    thesis:
      "Checkbox's Priority #2 says the Finance + IT assets exist; the work is adoption. Phase 2 makes the asset deploy itself when a deal hits Evaluating, then measures who actually used it. This is the move from intelligence layer to orchestration.",
    weeks: [
      {
        range: "Days 31 – 44",
        title: "Dock auto-deploy · Finance + IT",
        bullets: [
          "Dock Labs API: read existing workspaces, write new ones from template.",
          "Asset templates committed: assets/cfo-leave-behind.md, assets/it-zero-lift.md, assets/finance-meeting-brief.md.",
          "Trigger: opp moves to Evaluating in SF CDC → Dugout auto-creates a Dock workspace, pre-loaded with all three assets, tagged to the opp.",
          "Single Slack DM to the AE: 'Dock workspace staged for [Account]. Send to [champion] when ready.'",
          "Adoption telemetry: did the AE forward the Dock link within 5 business days? Tracked per AE, surfaced on /manager.",
        ],
        ships: "Asset-deploy rate per AE visible on the manager view.",
        kpi: "Baseline deploy rate measured Day 35. Target +30% by Day 60.",
      },
      {
        range: "Days 45 – 51",
        title: "HubSpot bridge · MQL handoff",
        bullets: [
          "HubSpot Contacts + Forms API (read-only).",
          "MQL threshold lives in HubSpot. When a contact crosses, Dugout enriches via ZoomInfo (cached) and creates an SF Lead via Bulk API.",
          "Duplicate detection on email + domain prevents the classic 'marketing creates a Lead for an existing Contact' failure.",
        ],
        ships: "MQL → SF Lead latency under 5 minutes. Dup rate under 2%.",
        kpi: "Two clean week-over-week numbers RevOps can show in the Monday meeting.",
      },
      {
        range: "Days 52 – 60",
        title: "Chili Piper · 24-hour pre-meeting brief",
        bullets: [
          "Chili Piper webhook: meeting booked → Dugout auto-generates the /account/[slug]/prep brief, keyed off the account pkey resolved from the calendar invite.",
          "Brief composition: SV Health, open blocking signals, latest Gong objection (extracted into the ontology in Phase 1), latest news from external_signals, asset-deploy status.",
          "Delivered as both a Slack DM and an email 24h before the meeting. AE picks the channel that fits their morning ritual.",
          "Fallback: if brief generation errors, the AE still gets a link to the /account view — never an empty Slack.",
        ],
        ships: "Every meeting with a tracked account gets a pre-meeting brief delivered, no AE action required.",
        kpi: "100% pre-meeting brief coverage on tracked-account meetings by Day 60.",
        model: {
          provider: "anthropic",
          note: "Sonnet 4.6 synthesizes the brief from ontology rows. Same model as the morning digest.",
        },
      },
    ],
    goesLive: ["dock", "hubspot", "chilipiper"],
    demoProof:
      "End of Phase 2: deal moves Demo Sat → Evaluating in Salesforce → Dock workspace auto-stages with three assets → AE gets a Slack ping → AE forwards the link → Finance contact added in HubSpot → SF Lead created → NO_FINANCE_AT_EVALUATING signal auto-clears. Full loop, real data, on stage.",
  },
  {
    id: "phase-3",
    number: "03",
    range: "Days 61 – 90",
    title: "Orchestration + SDR motion.",
    thesis:
      "Read-only was prudent. Phase 3 starts writing — but only after Phase 1's noise budget proved we can trust the rules. Signal-triggered Outreach sequences, narrow Salesforce write-back, ABM via real ZoomInfo Intent, and /ask v2 — an @-mention-resolved Q&A surface that walks the account pkey's relations graph. The shift from AI assistant to orchestration engine, with an audit row for every action.",
    weeks: [
      {
        range: "Days 61 – 74",
        title: "Outreach writes · triggered sequences",
        bullets: [
          "Outreach write scope: enroll prospects in sequences, create tasks, log calls.",
          "Signal-triggered enrollment: CHAMPION_GHOST fires → champion auto-enrolled in 'Champion Re-engagement' (3-step, AE-approved template library).",
          "Every write requires manager-tier rule approval. Rules can only flip to auto:true after Phase 2 proves <15% snooze rate.",
          "agent_actions audit table: every action gets a row with user attribution, rule id, before/after state, and a manual rollback path.",
        ],
        ships: "First fully-automated sequence enrollment + first auto-created SF task, both with audit trail.",
        kpi: "Zero rep-reported false-fires in the first 14 days of auto-mode.",
      },
      {
        range: "Days 75 – 81",
        title: "ZoomInfo + Salesforce write-back",
        bullets: [
          "ZoomInfo Enrich API + Intent API. Both write into the account ontology — firmographic, tech stack, buying intent topics — keyed off the same account pkey Gong and SF use.",
          "Auto-enrichment on account create. Cached for 30 days so we don't burn API credits re-pulling stable firmographic data.",
          "Salesforce write-back, narrow scope: Opportunity.NextStep is composed from the call-ontology row's next_step field — extracted in Phase 1 Week 2 — and normalized to RevOps' phrasing rules by Haiku 4.5.",
          "AE-override gate: if an AE edits NextStep manually, Dugout backs off that field on that opp for 7 days. Override events logged to agent_actions.",
        ],
        ships: "ZoomInfo enriches every new account into the ontology. NextStep writes back to SF from real call-ontology rows.",
        kpi: "% of opps with NextStep populated by Dugout vs. manual baseline, trending up week over week.",
        model: {
          provider: "anthropic",
          note: "Haiku 4.5 normalizes to RevOps phrasing. Extraction happened upstream in Phase 1.",
        },
      },
      {
        range: "Days 82 – 90",
        title: "/ask v2 · @mention → pkey → relations → answer",
        bullets: [
          "@mention resolver: an AE types '@Snowflake' or '@CNA' in /ask. Dugout resolves the mention to the canonical account pkey (acc_atlas, acc_sentinel) — the same pkey every integration writes to.",
          "Pkey relations graph: every Dugout table is keyed off account pkey — Gong calls, Outreach activities, SF opportunities, Firecrawl scrapes, newsletter signals, asset deliveries. The graph is the ontology.",
          "Intent router (Haiku 4.5, cheap): 'is the AE asking about risk? buying committee? recent news? next steps?' picks which relation tables to traverse for this question.",
          "Retrieval: pgvector semantic search over text-embedding-3-large, scoped to the resolved pkey + the routed relations.",
          "Synthesis: OpenAI GPT-4.1 generates the answer with inline citations back to source rows in the ontology. Free OpenAI credits cover all production traffic on this surface.",
          "Nooks + Swyft AI ingestion lands the same week — webhook → transcript → ontology row, keyed off pkey. Adds two more relation tables /ask can traverse.",
          "ABM_SHADOW_RESEARCH rule reads real ZoomInfo Intent (also pkey-keyed). Top-accounts manager card lights up with real intent topics.",
        ],
        ships: "@mention any account → 2-second cited answer drawn from every relation in the ontology.",
        kpi: "One signal → sequence → SF task → manager visibility motion provable on stage, with /ask able to explain the whole motion when @-mentioned.",
        model: {
          provider: "openai",
          note: "Haiku 4.5 routes intent · GPT-4.1 synthesizes. /ask is the only OpenAI-powered surface; the free credits cover it entirely.",
        },
      },
    ],
    goesLive: ["zoominfo", "nooks", "swyftai"],
    demoProof:
      "End of Phase 3: signal fires → Outreach sequence enrolled → SF task created → manager notified, fully auditable. Voice prep on a real account. 11 of 12 strategic integrations live. The orchestration engine the brief asked for.",
  },
];

// Day-90 end-state — the concrete promise the plan is making.
const END_STATE: { stat: string; label: string }[] = [
  { stat: "11 / 12", label: "strategic integrations live" },
  { stat: "18", label: "signal rules on real CRM data" },
  { stat: "+30%", label: "asset deploy rate per AE" },
  { stat: "<15%", label: "signal snooze rate (noise budget)" },
  { stat: "100%", label: "pre-meeting brief coverage" },
  { stat: "1", label: "orchestrated motion end-to-end" },
];

export function NinetyDayVision() {
  return (
    <section
      id="ninety-day-plan"
      className="relative border-b border-border bg-background"
    >
      <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
        <SectionEyebrow>90-day plan · the build if I&apos;m hired</SectionEyebrow>
        <h2 className="mt-3 text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
          Where Dugout goes
          <br />
          in 90 days.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-foreground/70 leading-relaxed max-w-2xl">
          What you scrolled through is Dugout today: 8 sources live, the rest of
          the stack shown as configured chips. Below is the week-by-week plan to
          wire Salesforce, Gong, Outreach, Dock, HubSpot, ZoomInfo and the rest
          — every integration writing into one canonical ontology keyed off the
          account pkey, with the right model doing the right job at each layer.
        </p>

        <TodayStrip />

        <OntologyCallout />

        <div className="mt-16 grid grid-cols-1 md:grid-cols-12 gap-10">
          <div className="md:col-span-3">
            <NinetyDayRail phases={PHASES.map(({ id, number, range, title }) => ({ id, number, range, title }))} />
          </div>
          <div className="md:col-span-9 space-y-20">
            {PHASES.map((p) => (
              <PhaseCard key={p.id} phase={p} />
            ))}
          </div>
        </div>

        <EndStateCard />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today strip — the honest "where we are" line that earns the right to make
// promises below. Mirrors the integration matrix's status legend.
// ---------------------------------------------------------------------------

function TodayStrip() {
  const liveToday: BrandKey[] = [
    "anthropic",
    "supabase",
    "newsapi",
    "sec",
    "firecrawl",
    "slack",
    "granola",
  ];
  return (
    <div className="mt-10 rounded-xl border border-border bg-foreground/[0.02] p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="text-[11px] uppercase tracking-[0.2em] font-mono text-muted">
          Today
        </div>
        <div className="text-[11px] uppercase tracking-[0.15em] font-mono text-muted">
          8 live · 1 beta · 12 configured
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        {liveToday.map((b) => (
          <div
            key={b}
            className="inline-flex items-center gap-2 rounded-full border border-severity-green/30 bg-severity-green-bg pl-1 pr-3 py-1"
            title={`${b} · live`}
          >
            <BrandLogo brand={b} size={20} />
            <span className="text-[11px] font-medium text-severity-green capitalize">
              live
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ontology callout — the load-bearing explainer. Every integration writes
// into one canonical ontology keyed off account pkey. Models are split by
// the work they're best at: Haiku for cheap per-row scoring, OpenAI for
// structured extraction into ontology shapes, Sonnet for synthesis the AE
// reads. /ask is the only production surface where OpenAI does the final
// output — that's where the free credits go.
// ---------------------------------------------------------------------------

interface OntologyLayer {
  layer: string;
  model: string;
  job: string;
  examples: string;
}

const ONTOLOGY_LAYERS: OntologyLayer[] = [
  {
    layer: "Per-row scoring",
    model: "Haiku 4.5",
    job: "Cheap, deterministic, high-volume",
    examples:
      "Sentiment scores · topic tags · allowlist checks · dedup · phrasing normalization",
  },
  {
    layer: "Ontology extraction",
    model: "OpenAI GPT-4.1",
    job: "Pull typed shapes out of unstructured text",
    examples:
      "Gong calls → commitments, objections, next-steps · SF notes → exec mentions · newsletters → company events",
  },
  {
    layer: "Synthesis",
    model: "Sonnet 4.6",
    job: "The output the AE actually reads",
    examples:
      "Morning digest · /account/[slug]/prep brief · /manager coaching brief · signal summaries",
  },
  {
    layer: "/ask — pkey-resolved Q&A",
    model: "OpenAI GPT-4.1",
    job: "Free credits cover production",
    examples:
      "@mention → resolve to account pkey → walk relations graph → cite source rows",
  },
];

function OntologyCallout() {
  return (
    <div className="mt-10 rounded-xl border border-border bg-background overflow-hidden">
      <div className="p-5 sm:p-6 border-b border-border">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
          The ontology · how the build hangs together
        </div>
        <p className="mt-3 text-sm sm:text-base text-foreground/80 leading-relaxed max-w-3xl">
          Every integration below writes into one canonical ontology, keyed off
          the account pkey. Calls, signals, contacts, opportunities, scrapes,
          newsletters — all of them are relations on the same account.{" "}
          <span className="text-foreground font-medium">
            Models are split by the work they&apos;re best at.
          </span>{" "}
          Haiku does the cheap per-row scoring. OpenAI does the structured
          extraction into ontology shapes. Sonnet writes the output the AE
          actually reads. /ask is the only production surface where OpenAI
          generates the final answer — and the free credits cover it.
        </p>
      </div>
      <div className="divide-y divide-border">
        {ONTOLOGY_LAYERS.map((row) => (
          <div
            key={row.layer}
            className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-5 p-4 sm:px-6 sm:py-4 items-baseline"
          >
            <div className="sm:col-span-3">
              <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
                Layer
              </div>
              <div className="mt-1 text-sm font-semibold tracking-tight">
                {row.layer}
              </div>
            </div>
            <div className="sm:col-span-3">
              <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
                Model
              </div>
              <div className="mt-1 text-sm font-mono text-brand">
                {row.model}
              </div>
              <div className="mt-0.5 text-[11px] text-muted">{row.job}</div>
            </div>
            <div className="sm:col-span-6">
              <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
                Touches
              </div>
              <div className="mt-1 text-sm text-foreground/75 leading-snug">
                {row.examples}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase card — the centerpiece of each scroll beat.
// ---------------------------------------------------------------------------

function PhaseCard({ phase }: { phase: PhaseSpec }) {
  return (
    <article
      id={phase.id}
      data-phase={phase.number}
      className="scroll-mt-24"
    >
      <header>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-brand">
            Phase {phase.number} / 03
          </span>
          <span className="text-[11px] uppercase tracking-[0.15em] font-mono text-muted">
            {phase.range}
          </span>
        </div>
        <h3 className="mt-3 text-2xl sm:text-4xl font-semibold tracking-tight">
          {phase.title}
        </h3>
        <p className="mt-4 text-base text-foreground/70 leading-relaxed max-w-2xl">
          {phase.thesis}
        </p>
      </header>

      <div className="mt-8 rounded-xl border border-border bg-foreground/[0.02] p-5 sm:p-6">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted mb-4">
          Integrations going live this phase
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {phase.goesLive.map((b) => (
            <div
              key={b}
              className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/[0.06] pl-1 pr-3 py-1"
            >
              <BrandLogo brand={b} size={22} />
              <span className="text-xs font-semibold text-brand capitalize">
                live in phase {phase.number}
              </span>
            </div>
          ))}
        </div>
      </div>

      <ol className="mt-10 space-y-8 border-l border-border pl-6 sm:pl-8 relative">
        {phase.weeks.map((w, i) => (
          <WeekEntry key={i} week={w} index={i} />
        ))}
      </ol>

      <div className="mt-10 rounded-xl border border-foreground/15 bg-foreground text-background p-5 sm:p-6">
        <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-background/60">
          Demo proof — end of phase {phase.number}
        </div>
        <p className="mt-3 text-sm sm:text-base leading-relaxed text-background/90">
          {phase.demoProof}
        </p>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Week entry — one week-row inside a phase. Numbered dot on the timeline,
// title + range, bullet list, ships line, KPI, optional model tag.
// ---------------------------------------------------------------------------

function WeekEntry({ week, index }: { week: WeekSpec; index: number }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute -left-[31px] sm:-left-[39px] top-1 w-3 h-3 rounded-full bg-brand ring-4 ring-background"
      />
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
          Week {index + 1}
        </span>
        <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted">
          · {week.range}
        </span>
      </div>
      <h4 className="mt-1.5 text-lg sm:text-xl font-semibold tracking-tight">
        {week.title}
      </h4>
      <ul className="mt-3 space-y-1.5">
        {week.bullets.map((b, j) => (
          <li
            key={j}
            className="text-sm text-foreground/75 leading-relaxed flex gap-2.5"
          >
            <span aria-hidden className="text-muted shrink-0 mt-[5px] text-[7px]">
              ●
            </span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <Callout label="Ships">{week.ships}</Callout>
        <Callout label="KPI" tone="brand">
          {week.kpi}
        </Callout>
      </div>
      {week.model && <ModelTag {...week.model} />}
    </li>
  );
}

function Callout({
  label,
  tone = "muted",
  children,
}: {
  label: string;
  tone?: "muted" | "brand";
  children: React.ReactNode;
}) {
  const labelCls =
    tone === "brand"
      ? "text-brand"
      : "text-muted";
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div
        className={`text-[10px] uppercase tracking-[0.2em] font-mono ${labelCls}`}
      >
        {label}
      </div>
      <div className="mt-1.5 text-sm text-foreground/85 leading-snug">
        {children}
      </div>
    </div>
  );
}

function ModelTag({
  provider,
  note,
}: {
  provider: "anthropic" | "openai";
  note: string;
}) {
  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-foreground/[0.03] pl-2 pr-3 py-1">
      {provider === "anthropic" ? (
        <BrandLogo brand="anthropic" size={18} />
      ) : (
        <OpenAIChip />
      )}
      <span className="text-[11px] text-foreground/70">{note}</span>
    </div>
  );
}

function OpenAIChip() {
  return (
    <span
      aria-hidden
      className="w-[18px] h-[18px] rounded bg-foreground inline-flex items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-3 h-3 text-background"
        fill="currentColor"
      >
        <path d="M22.28 9.82a5.95 5.95 0 0 0-.52-4.89 6 6 0 0 0-6.5-2.88A6 6 0 0 0 4.93 4.13a5.95 5.95 0 0 0-3.98 2.88 6 6 0 0 0 .74 7.06 5.95 5.95 0 0 0 .52 4.89 6 6 0 0 0 6.5 2.88 6 6 0 0 0 10.33-1.9 5.95 5.95 0 0 0 3.98-2.88 6 6 0 0 0-.74-7.24Zm-9.06 12.66a4.44 4.44 0 0 1-2.85-1.03l.14-.08 4.74-2.74a.78.78 0 0 0 .39-.68v-6.69l2 1.16.02.05v5.54a4.46 4.46 0 0 1-4.44 4.47Zm-9.55-4.08a4.44 4.44 0 0 1-.53-2.98l.14.08 4.74 2.74a.77.77 0 0 0 .78 0l5.79-3.34v2.31a.07.07 0 0 1-.03.06l-4.8 2.77a4.46 4.46 0 0 1-6.09-1.64Zm-1.24-10.3a4.44 4.44 0 0 1 2.32-1.95v5.64a.78.78 0 0 0 .39.67l5.79 3.34-2 1.16a.07.07 0 0 1-.07 0l-4.79-2.77a4.46 4.46 0 0 1-1.64-6.09Zm16.46 3.82-5.79-3.34 2-1.15a.07.07 0 0 1 .07 0l4.79 2.77a4.46 4.46 0 0 1-.68 8.04v-5.64a.79.79 0 0 0-.39-.68Zm1.99-3-.14-.08-4.74-2.74a.77.77 0 0 0-.78 0l-5.79 3.34v-2.31a.07.07 0 0 1 .03-.06l4.8-2.77a4.46 4.46 0 0 1 6.62 4.62Zm-12.55 4.13-2-1.16v-5.55a4.46 4.46 0 0 1 7.32-3.43l-.14.08-4.74 2.74a.78.78 0 0 0-.39.68Zm1.09-2.35 2.58-1.49 2.58 1.49v2.97l-2.58 1.49-2.58-1.49Z" />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// End-state card — Day 90 in one block. The concrete promise. The numbers
// here are what gets graded against if the plan ships.
// ---------------------------------------------------------------------------

function EndStateCard() {
  return (
    <div
      id="day-90"
      className="mt-24 rounded-2xl border border-border bg-foreground text-background p-8 sm:p-10 scroll-mt-24"
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[11px] uppercase tracking-[0.2em] font-mono text-background/60">
          Day 90 · the end state
        </span>
      </div>
      <h3 className="mt-3 text-2xl sm:text-4xl font-semibold tracking-tight leading-[1.1] max-w-2xl">
        The promise this plan is making.
      </h3>
      <p className="mt-4 text-sm sm:text-base leading-relaxed text-background/75 max-w-2xl">
        90 days from a Day-1 hire: the read-only intelligence layer is wired to
        the real stack, the noise budget is documented, and one orchestrated
        motion is auditable end-to-end. Every number below is a measurable
        commitment.
      </p>
      <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-8">
        {END_STATE.map((e) => (
          <div key={e.label}>
            <div className="text-3xl sm:text-4xl font-semibold tracking-tight">
              {e.stat}
            </div>
            <div className="mt-1.5 text-xs sm:text-sm text-background/70 leading-snug">
              {e.label}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-10 pt-6 border-t border-background/15 text-[11px] uppercase tracking-[0.2em] font-mono text-background/50">
        Built by Jackson Shuey · designed for the GTM Engineer role at Checkbox
      </div>
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.2em] font-mono text-muted">
      <span className="text-brand mr-2" aria-hidden>
        →
      </span>
      {children}
    </div>
  );
}
