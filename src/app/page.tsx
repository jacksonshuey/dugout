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
import { IntegrationSetupReel } from "@/components/landing/integration-setup-reel";
import { IntegrationsMatrix } from "@/components/landing/integrations-matrix";
import { MetricsCheckboxDemo } from "@/components/landing/metrics-checkbox-demo";
import { SecurityTrust } from "@/components/landing/security-trust";
import { INTEGRATIONS } from "@/data/integrations";
import { checkAllHealth, type IntegrationHealth } from "@/lib/integration-health";

const CONTACT_MAILTO =
  "mailto:jacksonshuey@gmail.com?subject=Dugout%20walkthrough";

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
      contractIdleAmountFloor: workspace.contractIdleAmountFloor,
    },
  };
  const signals = evaluateAll(ctx);
  // Server-side env-presence snapshot. Reads process.env once per request;
  // no network calls. Threaded through to the constellation + matrix so
  // both surfaces render the same answer.
  const integrationHealth = checkAllHealth();

  return (
    <div className="bg-background">
      <Hero />
      <IntegrationConstellation health={integrationHealth} />
      <IntegrationsMatrixSection health={integrationHealth} />
      <OnboardingWalkthrough />
      <SecurityTrustSection />
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
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer — quiet admin links to the other surfaces. The top nav was
// stripped to just the demo button to keep the marketing experience
// uncluttered; this footer makes the operator surfaces (manager view,
// spec, etc.) reachable without typing URLs.
// ---------------------------------------------------------------------------

function Footer() {
  const links: { href: string; label: string; sub: string }[] = [
    { href: "/console", label: "AE Console", sub: "Pipeline · Today · Digest" },
    { href: "/manager", label: "Manager view", sub: "Team aggregates · per-rep" },
    { href: "/market-intel", label: "Market intel", sub: "Workspace-wide news inbox" },
    { href: "/trial-intake", label: "Trial intake", sub: "48h SLA · companion system" },
    { href: "/spec", label: "Spec", sub: "Architecture + rollout" },
  ];
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="w-5 h-5 rounded-[5px] bg-brand flex items-center justify-center"
            >
              <svg
                viewBox="0 0 24 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
                className="w-3.5 h-3.5 text-white"
              >
                <polygon points="6,3 21,3 18,14 3,14" />
                <polygon
                  points="7.8,4.65 18.3,4.65 16.2,12.35 5.7,12.35"
                  strokeOpacity="0.4"
                />
              </svg>
            </span>
            <span className="font-semibold tracking-tight">Dugout</span>
            <span className="text-xs text-muted ml-1">
              · the intelligence layer for sales teams
            </span>
          </div>
          <span className="text-[11px] text-muted font-mono">
            Built by Jackson Shuey ·{" "}
            <a
              href={CONTACT_MAILTO}
              className="hover:text-brand transition-colors"
            >
              jacksonshuey@gmail.com
            </a>
          </span>
        </div>
        <nav
          aria-label="Operator surfaces"
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 pt-4 border-t border-border"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group block space-y-0.5"
            >
              <div className="text-sm font-medium group-hover:text-brand transition-colors">
                {l.label} <span aria-hidden>→</span>
              </div>
              <div className="text-[11px] text-muted">{l.sub}</div>
            </Link>
          ))}
        </nav>
      </div>
    </footer>
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
          Dugout · the intelligence layer for sales teams
        </div>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
          Never walk into
          <br />
          a meeting cold.
        </h1>
        <p className="mt-5 text-lg sm:text-xl text-background/70 max-w-2xl leading-relaxed">
          Every tool, every signal, every news cycle, synthesized into a
          knowledge layer your AEs and managers rely on before each meeting.
          Deals stop dying because someone walked in unprepared.
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
          <a
            href={CONTACT_MAILTO}
            className="inline-flex items-center px-5 h-11 rounded-lg border border-background/20 text-background text-sm font-medium hover:bg-background/5 transition-colors"
          >
            Talk to Jackson →
          </a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Integration constellation — visual: Dugout in the center, integration
// logos arranged around it. Each chip is a real brand-colored logo.
// The integration list is owned by `src/data/integrations.ts` so the matrix
// below and the constellation here can't drift.
// ---------------------------------------------------------------------------

function IntegrationConstellation({
  health,
}: {
  health: Record<string, IntegrationHealth>;
}) {
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
            Dugout reads from the systems that already capture buyer behavior +
            the news your buyers&apos; verticals run on. Pluggable adapters:
            adding a source is a file, not an architecture change. Easy to
            plug in: paste a key, verify, sync.
          </p>
          <div className="mt-6 flex items-center gap-4 text-xs">
            <StatusKey color="bg-severity-green" label="Live" />
            <StatusKey color="bg-severity-action" label="Beta" />
            <StatusKey color="bg-slate-400" label="Display" />
            <StatusKey color="bg-severity-blocking" label="Key missing" />
          </div>
        </div>
        <div className="md:col-span-7">
          <IntegrationSetupReel integrations={INTEGRATIONS} health={health} />
        </div>
      </div>
    </section>
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
// 2b. Integrations matrix — productized view of the same list the
// constellation visualizes. Status · Auth · Where it runs · Direction.
// ---------------------------------------------------------------------------

function IntegrationsMatrixSection({
  health,
}: {
  health: Record<string, IntegrationHealth>;
}) {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-b border-border">
      <div className="max-w-3xl">
        <SectionEyebrow>Matrix</SectionEyebrow>
        <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight">
          Status, auth, and where the data lives.
        </h2>
        <p className="mt-4 text-base text-foreground/70 leading-relaxed">
          The constellation is the hook. This is the answer. Every
          integration with how it authenticates, where the adapter runs,
          and which direction data moves. Nothing here is aspirational —
          if it&apos;s Live, the cron is running and the rows are in
          Supabase. The <span className="font-mono text-xs">Configured</span>{" "}
          column reads <span className="font-mono text-xs">process.env</span>{" "}
          on this server right now.
        </p>
      </div>
      <div className="mt-10">
        <IntegrationsMatrix health={health} />
      </div>
    </section>
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
        From paste-a-key to first signal in four steps.
      </h2>
      <div className="mt-10">
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
    <div className="grid md:grid-cols-12 gap-6 items-center border-t border-border py-10 sm:py-12">
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
      <div className="space-y-5">
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
      sub="What you already use. Stack identity flows into the digest prompt and the drawer: 'Gong call excerpts' shows up as 'Granola' if you picked Granola."
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
      <div className="mt-8">
        <MetricsCheckboxDemo />
      </div>
    </StepShell>
  );
}

// Role icons for the data-flow diagram. Stroke-based, inherit currentColor.
function BriefcaseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
    >
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M3 13h18" />
    </svg>
  );
}
function HeadsetIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
    >
      <path d="M4 13a8 8 0 0 1 16 0" />
      <rect x="3" y="13" width="4" height="7" rx="1" />
      <rect x="17" y="13" width="4" height="7" rx="1" />
      <path d="M19 20v1a2 2 0 0 1-2 2h-3" />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
    >
      <path d="M3 3v18h18" />
      <rect x="7" y="14" width="3" height="4" />
      <rect x="12" y="10" width="3" height="8" />
      <rect x="17" y="6" width="3" height="12" />
    </svg>
  );
}

function StepFour() {
  // Connect data sources — flow diagram. SVG draws dashed curves between
  // source chips → the Dugout hub → role chips. Everything lives in one
  // viewBox so geometry stays aligned at every breakpoint; foreignObject
  // embeds React components (BrandLogo, role icons, hub) so they scale
  // with the SVG.
  const sources: { brand: BrandKey; cx: number; cy: number }[] = [
    { brand: "newsapi", cx: 70, cy: 50 },
    { brand: "granola", cx: 70, cy: 130 },
    { brand: "slack", cx: 70, cy: 210 },
    { brand: "anthropic", cx: 70, cy: 290 },
    { brand: "sec", cx: 190, cy: 90 },
    { brand: "supabase", cx: 190, cy: 250 },
  ];
  const roles: { label: string; cy: number; icon: React.ReactNode }[] = [
    { label: "AE", cy: 90, icon: <BriefcaseIcon /> },
    { label: "SDR", cy: 170, icon: <HeadsetIcon /> },
    { label: "Manager", cy: 250, icon: <ChartIcon /> },
  ];
  const hubLeft = 290;
  const hubRight = 410;
  const hubCy = 170;
  const roleLeft = 500;
  const roleWidth = 95;
  return (
    <StepShell
      num={3}
      title="Connect data sources"
      sub="API keys live in Supabase Vault, encrypted at rest, never returned to the browser. Sources stream into Dugout; the engine routes signals to your team."
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
              d={`M ${hubRight} ${hubCy} C ${hubRight + 50} ${hubCy}, ${roleLeft - 50} ${r.cy}, ${roleLeft} ${r.cy}`}
              stroke="currentColor"
              strokeWidth="1.25"
              fill="none"
              strokeDasharray="3 4"
              className="flow-path"
            />
          ))}

          {/* Source chips with name labels */}
          {sources.map((s) => (
            <foreignObject
              key={`chip-${s.brand}`}
              x={s.cx - 40}
              y={s.cy - 20}
              width={80}
              height={60}
            >
              <div className="flex flex-col items-center gap-1">
                <BrandLogo brand={s.brand} size={40} />
                <span className="text-[10px] text-muted whitespace-nowrap leading-none">
                  {getBrandName(s.brand)}
                </span>
              </div>
            </foreignObject>
          ))}

          {/* Dugout hub — matches the nav: brand-color chip with the
              baseball-base mark + wordmark. */}
          <foreignObject
            x={hubLeft}
            y={hubCy - 28}
            width={hubRight - hubLeft}
            height={56}
          >
            <div className="w-full h-full rounded-xl bg-brand text-white flex items-center justify-center gap-2 shadow-sm">
              <span className="w-6 h-6 rounded-[6px] bg-white/15 flex items-center justify-center shrink-0">
                <svg
                  viewBox="0 0 24 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-white"
                >
                  <polygon points="6,3 21,3 18,14 3,14" />
                  <polygon
                    points="7.8,4.65 18.3,4.65 16.2,12.35 5.7,12.35"
                    strokeOpacity="0.4"
                  />
                </svg>
              </span>
              <span className="text-base font-semibold tracking-tight">
                Dugout
              </span>
            </div>
          </foreignObject>

          {/* Role chips with icons */}
          {roles.map((r) => (
            <foreignObject
              key={`role-${r.label}`}
              x={roleLeft}
              y={r.cy - 18}
              width={roleWidth}
              height={36}
            >
              <div className="w-full h-full rounded-lg border border-border bg-background flex items-center justify-center gap-1.5 px-2 text-foreground">
                {r.icon}
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
        className={`text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 rounded border shrink-0 inline-flex items-center justify-center w-[72px] ${cls}`}
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
// Security / trust — surfaces real posture (Vault, HMAC, RLS, no-write)
// that's already in the code but invisible to the marketing reader.
// ---------------------------------------------------------------------------

function SecurityTrustSection() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-b border-border">
      <SectionEyebrow>Security posture</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
        Four constraints we don&apos;t bend.
      </h2>
      <p className="mt-4 text-base text-foreground/70 leading-relaxed max-w-3xl">
        Required reading before pointing Dugout at a real CRM. Each
        constraint links to the code that enforces it.
      </p>
      <div className="mt-10">
        <SecurityTrust />
      </div>
    </section>
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
        Below this point is the actual console. Same component, same seed,
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
      <span className="text-brand mr-2" aria-hidden>
        →
      </span>
      {children}
    </div>
  );
}
