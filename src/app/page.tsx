import Link from "next/link";
import {
  accounts,
  activities,
  assetDeliveries,
  calls,
  contacts,
  opportunities,
  reps,
} from "@/data/seed";
import { evaluateAll } from "@/lib/signal-engine";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import { CHECKBOX_PRESET } from "@/lib/workspace";
import { Console } from "@/components/console";
import {
  BrandLogo,
  getBrandName,
  type BrandKey,
} from "@/components/landing/logos";

// Landing page. Single scroll: vision → integration constellation →
// onboarding walkthrough → live demo embedded.
//
// The demo at the bottom is the real Console — same component as /console,
// same seed data, same interactivity. basePath="/" keeps its URL state
// writes from bouncing the user out of the page.

export default async function LandingPage() {
  const workspace = await getWorkspaceConfig();
  const ctx = {
    opportunities,
    accounts,
    contacts,
    activities,
    calls,
    deliveries: assetDeliveries,
    reps,
    config: {
      companyName: workspace.companyName,
      assets: workspace.assets,
      stack: workspace.stack,
    },
  };
  const signals = evaluateAll(ctx);

  return (
    <div className="bg-background">
      <Hero />
      <IntegrationConstellation />
      <OnboardingWalkthrough />
      <DemoDivider />
      <section id="demo" className="border-t border-border bg-foreground/[0.02]">
        <Console
          basePath="/"
          signals={signals}
          opportunities={opportunities}
          accounts={accounts}
          contacts={contacts}
          activities={activities}
          calls={calls}
          deliveries={assetDeliveries}
          reps={reps}
          workspace={workspace}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Hero — concise. One thesis, one CTA, one stat strip.
// ---------------------------------------------------------------------------

function Hero() {
  return (
    <section className="relative bg-foreground text-background overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div className="relative max-w-6xl mx-auto px-6 py-20 sm:py-24">
        <div className="text-xs uppercase tracking-[0.2em] text-background/60 font-mono mb-5">
          Dugout · the information hub for sales teams
        </div>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
          Every signal.
          <br />
          The next action.
        </h1>
        <p className="mt-5 text-lg sm:text-xl text-background/70 max-w-2xl leading-relaxed">
          Sales teams run on seven tools. Dugout reads from all of them, applies
          a deterministic engine, and surfaces what to do — on the right deal,
          at the right moment.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 items-center">
          <Link
            href="#demo"
            className="inline-flex items-center px-5 h-11 rounded-lg bg-background text-foreground text-sm font-semibold hover:bg-background/90 transition-colors"
          >
            See the live demo ↓
          </Link>
          <Link
            href="/spec"
            className="inline-flex items-center px-5 h-11 rounded-lg border border-background/20 text-background text-sm font-medium hover:bg-background/5 transition-colors"
          >
            Read the spec
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Integration constellation — visual: Dugout in the center, integration
// logos arranged around it. Each chip is a real brand-colored logo.
// ---------------------------------------------------------------------------

interface IntegrationSlot {
  brand: BrandKey;
  role: string;
  status: "live" | "v1.5" | "config";
}

const INTEGRATIONS: IntegrationSlot[] = [
  { brand: "newsapi", role: "Material news classification", status: "live" },
  { brand: "sec", role: "8-K filings · public-co signals", status: "live" },
  { brand: "inbox", role: "Newsletter market intel", status: "live" },
  { brand: "anthropic", role: "Sonnet 4.6 + Haiku 4.5", status: "live" },
  { brand: "slack", role: "Severity-tiered delivery", status: "live" },
  { brand: "supabase", role: "Signals + Vault-encrypted keys", status: "live" },
  { brand: "granola", role: "Meeting signal extraction", status: "v1.5" },
  { brand: "salesforce", role: "CRM read · workspace config", status: "config" },
  { brand: "gong", role: "Call transcripts · workspace config", status: "config" },
  { brand: "outreach", role: "Sales engagement · workspace config", status: "config" },
  { brand: "dock", role: "Deal rooms · workspace config", status: "config" },
  { brand: "chilipiper", role: "Scheduling · workspace config", status: "config" },
];

function IntegrationConstellation() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-b border-border">
      <SectionEyebrow>Integrations</SectionEyebrow>
      <div className="mt-3 grid md:grid-cols-12 gap-10 items-start">
        <div className="md:col-span-5">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            One synthesis layer
            <br />
            over your stack.
          </h2>
          <p className="mt-4 text-base text-foreground/70 leading-relaxed">
            Dugout reads from the systems that already capture buyer behavior.
            Adapter pattern: adding a source is a file, not an architecture
            change.
          </p>
          <div className="mt-6 flex items-center gap-4 text-xs">
            <StatusKey color="bg-severity-green" label="Live" />
            <StatusKey color="bg-severity-action" label="v1.5" />
            <StatusKey color="bg-slate-400" label="Display" />
          </div>
        </div>
        <div className="md:col-span-7">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {INTEGRATIONS.map((i) => (
              <IntegrationChip key={i.brand} integration={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function IntegrationChip({ integration }: { integration: IntegrationSlot }) {
  const dot =
    integration.status === "live"
      ? "bg-severity-green"
      : integration.status === "v1.5"
        ? "bg-severity-action"
        : "bg-slate-400";
  return (
    <div className="rounded-xl border border-border bg-background p-3 flex items-center gap-3 hover:border-foreground/20 transition-colors">
      <BrandLogo brand={integration.brand} size={40} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold tracking-tight text-sm truncate">
            {getBrandName(integration.brand)}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
        </div>
        <div className="text-[11px] text-muted truncate">
          {integration.role}
        </div>
      </div>
    </div>
  );
}

function StatusKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="text-muted">{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// 3. Onboarding walkthrough — 4 steps, each with a visualization that
// integrates the real product UI elements (priorities, stack chips,
// integration logos, signal cards).
// ---------------------------------------------------------------------------

function OnboardingWalkthrough() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-b border-border">
      <SectionEyebrow>Onboarding · end to end</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
        From paste-a-key to first signal — four steps.
      </h2>
      <div className="mt-12 space-y-6">
        <StepTwo />
        <StepThree />
        <StepFour />
        <StepFive />
      </div>
    </section>
  );
}

function StepShell({
  num,
  title,
  sub,
  children,
}: {
  num: number;
  title: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid md:grid-cols-12 gap-6 items-center rounded-2xl border border-border bg-background p-6 sm:p-8">
      <div className="md:col-span-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted">
            STEP 0{num} / 04
          </span>
        </div>
        <h3 className="text-xl sm:text-2xl font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-muted leading-relaxed">{sub}</p>
      </div>
      <div className="md:col-span-8">{children}</div>
    </div>
  );
}

function StepTwo() {
  // Priorities + ICP — show real CHECKBOX_PRESET data.
  return (
    <StepShell
      num={1}
      title="Define priorities + kill point"
      sub="Strategic priorities tag every signal rule. The kill-point sentence is the single thing your engine optimizes around."
    >
      <div className="rounded-xl border border-border bg-foreground/[0.02] p-5 space-y-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Kill point
          </div>
          <div className="text-sm font-medium mt-1 leading-snug">
            {CHECKBOX_PRESET.killPoint}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted font-mono">
            Strategic priorities · {CHECKBOX_PRESET.priorities.length}
          </div>
          {CHECKBOX_PRESET.priorities.slice(0, 4).map((p) => (
            <div
              key={p.id}
              className="flex items-baseline gap-2 text-sm leading-snug"
            >
              <span className="font-mono text-[11px] text-muted shrink-0 w-7">
                {p.id}
              </span>
              <span className="text-foreground">{p.name}</span>
            </div>
          ))}
          <div className="text-[11px] text-muted pl-9">
            + {CHECKBOX_PRESET.priorities.length - 4} more
          </div>
        </div>
      </div>
    </StepShell>
  );
}

function StepThree() {
  // Stack mapping — horizontal marquee of recognizable sales-stack brands.
  // The CSS class .marquee-track animates infinitely; we duplicate the list
  // so the loop is seamless. Container is overflow-hidden so the wider
  // logo strip doesn't break page layout. Order is intentionally mixed
  // across categories (CRM → CI → engagement → ...) so adjacent chips
  // don't all look alike during a slow stretch of the loop.
  const stackBrands: BrandKey[] = [
    "salesforce",
    "gong",
    "outreach",
    "dock",
    "chilipiper",
    "zoominfo",
    "hubspot",
    "chorus",
    "salesloft",
    "aligned",
    "calendly",
    "clay",
    "pipedrive",
    "fathom",
    "apollo",
    "trumpet",
    "calcom",
    "leadiq",
    "attio",
    "tldv",
    "mixmax",
    "cognism",
    "loom",
    "zoom",
    "docusign",
    "pandadoc",
    "notion",
  ];
  return (
    <StepShell
      num={2}
      title="Map your stack"
      sub="What you already use. Stack identity flows into the digest prompt and the drawer — 'Gong call excerpts' shows up as 'Granola' if you picked Granola."
    >
      <div className="marquee-container relative overflow-hidden">
        {/* Edge fades so logos enter/exit softly instead of clipping */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-16 z-10"
          style={{
            background:
              "linear-gradient(to right, var(--background), transparent)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 z-10"
          style={{
            background:
              "linear-gradient(to left, var(--background), transparent)",
          }}
        />
        <div className="marquee-track flex gap-4 w-max py-2">
          {/* Two copies of the list — required for a seamless loop */}
          {[...stackBrands, ...stackBrands].map((b, i) => (
            <div
              key={`${b}-${i}`}
              className="flex flex-col items-center gap-1.5 shrink-0"
              style={{ width: "84px" }}
            >
              <BrandLogo brand={b} size={48} />
              <span className="text-[11px] text-muted whitespace-nowrap">
                {getBrandName(b)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </StepShell>
  );
}

function StepFour() {
  // Connect data sources — visualized as a flow diagram. SVG draws dashed
  // curves between source chips → the Dugout hub → role chips on the right.
  // Everything lives in one viewBox (600×340) so the curves and chips line
  // up at every breakpoint; foreignObject embeds the BrandLogo components
  // so they scale with the SVG instead of fighting it.
  const sources: { brand: BrandKey; cx: number; cy: number }[] = [
    { brand: "newsapi", cx: 60, cy: 50 },
    { brand: "granola", cx: 60, cy: 130 },
    { brand: "slack", cx: 60, cy: 210 },
    { brand: "anthropic", cx: 60, cy: 290 },
    { brand: "sec", cx: 170, cy: 90 },
    { brand: "inbox", cx: 170, cy: 170 },
    { brand: "supabase", cx: 170, cy: 250 },
  ];
  const roles: { label: string; cy: number }[] = [
    { label: "AE", cy: 90 },
    { label: "SDR", cy: 170 },
    { label: "Manager", cy: 250 },
  ];
  const hubLeft = 270;
  const hubRight = 390;
  const hubCy = 170;
  return (
    <StepShell
      num={3}
      title="Connect data sources"
      sub="API keys live in Supabase Vault — encrypted at rest, never returned to the browser. Sources stream into Dugout; the engine routes signals to your team."
    >
      <div className="relative w-full" style={{ aspectRatio: "600 / 340" }}>
        <svg
          viewBox="0 0 600 340"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 w-full h-full text-foreground/30"
        >
          {/* Source → hub curves */}
          {sources.map((s) => (
            <path
              key={`in-${s.brand}`}
              d={`M ${s.cx + 20} ${s.cy} C ${s.cx + 90} ${s.cy}, ${hubLeft - 60} ${hubCy}, ${hubLeft} ${hubCy}`}
              stroke="currentColor"
              strokeWidth="1.25"
              fill="none"
              strokeDasharray="3 4"
              className="flow-path"
            />
          ))}
          {/* Hub → role curves */}
          {roles.map((r) => (
            <path
              key={`out-${r.label}`}
              d={`M ${hubRight} ${hubCy} C ${hubRight + 60} ${hubCy}, 460 ${r.cy}, 510 ${r.cy}`}
              stroke="currentColor"
              strokeWidth="1.25"
              fill="none"
              strokeDasharray="3 4"
              className="flow-path"
            />
          ))}

          {/* Source chips */}
          {sources.map((s) => (
            <foreignObject
              key={`chip-${s.brand}`}
              x={s.cx - 20}
              y={s.cy - 20}
              width={40}
              height={40}
            >
              <BrandLogo brand={s.brand} size={40} />
            </foreignObject>
          ))}

          {/* Dugout hub */}
          <foreignObject
            x={hubLeft}
            y={hubCy - 32}
            width={hubRight - hubLeft}
            height={64}
          >
            <div className="w-full h-full rounded-xl bg-foreground text-background flex flex-col items-center justify-center shadow-sm">
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] opacity-60">
                Engine
              </span>
              <span className="text-base font-semibold tracking-tight leading-tight">
                Dugout
              </span>
            </div>
          </foreignObject>

          {/* Role chips */}
          {roles.map((r) => (
            <foreignObject
              key={`role-${r.label}`}
              x={510}
              y={r.cy - 18}
              width={72}
              height={36}
            >
              <div className="w-full h-full rounded-lg border border-border bg-background flex items-center justify-center">
                <span className="text-xs font-semibold tracking-tight">
                  {r.label}
                </span>
              </div>
            </foreignObject>
          ))}
        </svg>
      </div>
    </StepShell>
  );
}

function StepFive() {
  // Signals flow in — show stylized signal cards landing in a feed.
  const signalSamples: {
    severity: "blocking" | "action" | "awareness";
    title: string;
    sub: string;
    account: string;
  }[] = [
    {
      severity: "blocking",
      title: "Champion departed → Ironclad",
      sub: "Boeing · LinkedIn updated 5/20",
      account: "Boeing",
    },
    {
      severity: "action",
      title: "Finance brief unsent · 14d in Selected Vendor",
      sub: "CNA Financial · auto-detected gap",
      account: "CNA Financial",
    },
    {
      severity: "awareness",
      title: "Snowflake Series E · budget environment improved",
      sub: "TechCrunch · classified by Haiku 4.5",
      account: "Snowflake",
    },
  ];
  return (
    <StepShell
      num={4}
      title="Signals start flowing"
      sub="13 deterministic rules over your CRM data. News + SEC + meetings classified by Haiku. Severity routing: blocking → page, action → digest, awareness → weekly."
    >
      <div className="space-y-2">
        {signalSamples.map((s, i) => (
          <SignalSampleCard key={i} {...s} />
        ))}
      </div>
    </StepShell>
  );
}

function SignalSampleCard({
  severity,
  title,
  sub,
}: {
  severity: "blocking" | "action" | "awareness";
  title: string;
  sub: string;
  account: string;
}) {
  const cls =
    severity === "blocking"
      ? "bg-severity-blocking-bg text-severity-blocking border-severity-blocking/20"
      : severity === "action"
        ? "bg-severity-action-bg text-severity-action border-severity-action/20"
        : "bg-severity-awareness-bg text-severity-awareness border-severity-awareness/20";
  return (
    <div className="rounded-lg border border-border bg-background p-3 flex items-start gap-3">
      {/* Mono uppercase tracked label — matches the "STEP 0X / 05" eyebrow
          treatment used elsewhere on this card so the typography reads as
          one coherent system, not two. */}
      <span
        className={`text-[10px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded border shrink-0 ${cls}`}
      >
        {severity}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold tracking-tight leading-snug">
          {title}
        </div>
        <div className="text-xs text-muted leading-relaxed mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo divider — sets context that the live console is below.
// ---------------------------------------------------------------------------

function DemoDivider() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-16 text-center">
      <SectionEyebrow centered>Live demo</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">
        Scroll. It&apos;s real.
      </h2>
      <p className="mt-3 text-sm text-muted max-w-xl mx-auto">
        Below this point is the actual console — same component, same seed,
        same signal engine. 11 real public-company accounts. Click any row.
      </p>
      <div className="mt-6 text-muted text-xl" aria-hidden>
        ↓
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SectionEyebrow({
  children,
  centered = false,
}: {
  children: React.ReactNode;
  centered?: boolean;
}) {
  return (
    <div
      className={`text-[11px] uppercase tracking-[0.2em] font-mono text-muted ${
        centered ? "text-center" : ""
      }`}
    >
      {children}
    </div>
  );
}
