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
import { LiveZipperingDemo } from "@/components/landing/live-zippering-demo";
import { InteractiveZipperedTable } from "@/components/landing/interactive-zippered-table";
import { InteractiveSignals } from "@/components/landing/interactive-signals";
import { InteractiveDecisions } from "@/components/landing/interactive-decisions";
import { INTEGRATIONS } from "@/data/integrations";
import { checkAllHealth } from "@/lib/integration-health";
import { RefreshButton } from "@/components/landing/refresh-button";
import { ClientNewsTicker } from "@/components/landing/client-news-ticker";
import { SortableWorkspaceFeed } from "@/components/landing/sortable-workspace-feed";
import {
  getWorkspaceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";

// 60-second ISR window. Tight enough that the workspace inbox + transform
// visual feel fresh on each visit; loose enough that Supabase isn't hit on
// every individual page load. The ticker is additionally polled client-side
// every 30s so it visibly updates between ISR cycles.
export const revalidate = 60;

const CONTACT_MAILTO =
  "mailto:jacksonshuey@gmail.com?subject=Dugout%20walkthrough";

const MARKET_INTEL_LOOKBACK_DAYS = 30;
const MARKET_INTEL_PREVIEW_LIMIT = 5;

// Landing page. Single scroll: vision → integration constellation →
// onboarding walkthrough → live demo embedded.
//
// The demo at the bottom is the real Console - same component as /console,
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

  return (
    <div className="bg-background">
      <Hero />
      <OnboardingWalkthrough />
      <section id="demo" className="border-t border-border bg-foreground/[0.02]">
        <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Dashboard
          </h2>
          <p className="mt-2 text-sm text-muted">
            Live console. Pipeline and today&apos;s open tasks, by severity.
          </p>
        </div>
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
      <MarketIntelLiveSection />
      <NextUpSection />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next up - brief 90-day roadmap. Three workstreams, no detail.
// ---------------------------------------------------------------------------

function NextUpSection() {
  const items: { title: string; sub: string }[] = [
    {
      title: "Organization-specific integration scaffolding",
      sub: "Per-customer connectors so each new workspace wires up Salesforce, Slack, Gong, and Outreach through the same setup-reel flow.",
    },
    {
      title: "Workflow automations",
      sub: "Promote rule streams from preview to firing: Slack DMs, Dock workspace creation, Outreach enrollment, asset delivery on the chain.",
    },
    {
      title: "User account creation",
      sub: "Multi-tenant auth so individual AEs and managers sign into their own workspace instead of sharing a demo session.",
    },
  ];
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-t border-border">
      <SectionEyebrow>90-day plan</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
        What&apos;s next.
      </h2>
      <p className="mt-4 text-base text-foreground/70 leading-relaxed max-w-2xl">
        Three workstreams between now and day 90 to turn the demo into a
        tool a real team can adopt.
      </p>
      <ol className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {items.map((item, i) => (
          <li
            key={item.title}
            className="rounded-lg border border-border bg-background p-5 space-y-2"
          >
            <span className="text-[11px] uppercase tracking-[0.15em] font-mono text-brand">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="text-sm font-semibold tracking-tight leading-snug">
              {item.title}
            </h3>
            <p className="text-xs text-muted leading-relaxed">{item.sub}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer - quiet admin links to the other surfaces. The top nav was
// stripped to just the demo button to keep the marketing experience
// uncluttered; this footer makes the operator surfaces (manager view,
// spec, etc.) reachable without typing URLs.
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-6 py-16">
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
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// 1. Hero - concise. One thesis, one CTA, one stat strip.
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
      <div className="relative max-w-6xl mx-auto px-6 py-24 sm:py-32">
        <div className="text-xs uppercase tracking-[0.2em] text-background/60 font-mono mb-5">
          Dugout · the intelligence layer for sales teams
        </div>
        <h1 className="text-4xl sm:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
          Never walk into
          <br />
          a meeting cold.
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-background/70 max-w-2xl leading-relaxed">
          Every tool, every signal, every news cycle, synthesized into a
          knowledge layer your AEs and managers rely on before each meeting.
          Deals stop dying because someone walked in unprepared.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// All integrate / zipper / ontology content lives inside the
// OnboardingWalkthrough section below — see StepIntegrate, StepZipper,
// StepOntology. The old IntegrationConstellation and NewsLayerSection
// were folded into those steps so the page has one main narrative.

// ---------------------------------------------------------------------------
// 3. Onboarding walkthrough - 4 steps, each with a visualization that
// integrates the real product UI elements (priorities, stack chips,
// integration logos, signal cards).
// ---------------------------------------------------------------------------

function OnboardingWalkthrough() {
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
      <SectionEyebrow>How the engine works</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
        Integrate, zipper, ontology, rules, actions.
      </h2>
      <p className="mt-4 text-base text-foreground/70 leading-relaxed max-w-2xl">
        Each stage builds on the one before. Integrations write into a single
        ontology. Rules fire over that ontology. The AE acts on the result.
      </p>
      <div className="mt-10">
        <StepIntegrate />
        <StepZipper />
        <StepOntology />
        <StepRules />
        <StepActions />
      </div>
    </section>
  );
}

function StepShell({
  num,
  title,
  sub,
  children,
  wide = false,
}: {
  num: number;
  title: string;
  sub: string;
  children: React.ReactNode;
  // When true, the step renders the header above and the visual full-width
  // below. Use for steps whose visuals don't fit the 4/8 column split
  // (Integrate, Zipper, Ontology — each has a richer in-step demo).
  wide?: boolean;
}) {
  if (wide) {
    return (
      <div className="border-t border-border py-10 sm:py-12">
        <div className={"space-y-2 max-w-3xl " + (sub ? "mb-8" : "mb-6")}>
          <span className="font-mono text-xs text-muted">
            STEP 0{num} / 05
          </span>
          <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            {title}
          </h3>
          {sub && (
            <p className="text-sm text-muted leading-relaxed">{sub}</p>
          )}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="grid md:grid-cols-12 gap-6 items-center border-t border-border py-10 sm:py-12">
      <div className="md:col-span-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted">
            STEP 0{num} / 05
          </span>
        </div>
        <h3 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-sm text-muted leading-relaxed">{sub}</p>
      </div>
      <div className="md:col-span-8">{children}</div>
    </div>
  );
}

function StepIntegrate() {
  // Horizontal marquee of recognizable sales-stack brands. The CSS class
  // .marquee-track animates infinitely; we duplicate the list so the loop
  // is seamless. Container is overflow-hidden so the wider logo strip
  // doesn't break page layout.
  const stackBrands: BrandKey[] = [
    "salesforce",
    "gong",
    "outreach",
    "dock",
    "chilipiper",
    "zoominfo",
    "hubspot",
    "nooks",
    "swyftai",
    "xero",
    "zendesk",
    "webflow",
    "granola",
    "slack",
  ];
  const integrationHealth = checkAllHealth();
  return (
    <StepShell num={1} wide title="Integrate" sub="">
      <div className="grid md:grid-cols-12 gap-8">
        <div className="md:col-span-5 min-w-0 flex flex-col">
          <div className="space-y-3">
            <p className="text-sm text-foreground/70 leading-relaxed">
              <span className="font-semibold text-foreground">
                Integrate with your existing tools.
              </span>{" "}
              Each tool plugs in the same way: paste an API key, set sync
              frequency, verify, done. Credentials encrypt in Supabase Vault
              and never reach the browser. Granola is the example here: the
              same flow works for every adapter shown.
            </p>
            <p className="text-sm text-foreground/70 leading-relaxed">
              No per-source schema design. The adapter resolves the account
              and emits raw rows; the zipper step (next) handles the rest.
            </p>
          </div>
          <div className="mt-auto pb-2 space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
              Checkbox stack · {stackBrands.length} tools
            </div>
            <div className="marquee-container relative w-full max-w-full overflow-hidden">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-10 z-10"
                style={{ background: "linear-gradient(to right, var(--background), transparent)" }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-10 z-10"
                style={{ background: "linear-gradient(to left, var(--background), transparent)" }}
              />
              <div className="marquee-track flex gap-3 w-max py-2">
                {[...stackBrands, ...stackBrands].map((b, i) => (
                  <div
                    key={`${b}-${i}`}
                    className="flex flex-col items-center gap-1 shrink-0"
                    style={{ width: "85px" }}
                  >
                    <BrandLogo brand={b} size={45} />
                    <span className="text-[10px] text-muted whitespace-nowrap">
                      {getBrandName(b)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="md:col-span-7 min-w-0">
          <IntegrationSetupReel
            integrations={INTEGRATIONS}
            health={integrationHealth}
          />
        </div>
      </div>
    </StepShell>
  );
}

function StepZipper() {
  // Live, animated demo of the join: three real source paths get routed
  // into one canonical column on the account's wide row. AI verdict cycles
  // through columns automatically.
  return (
    <StepShell
      num={2}
      wide
      title="Zipper"
      sub="AI reads each incoming column, matches it against the canonical columns we already track for the account, and routes it. Same data, one shape."
    >
      <LiveZipperingDemo />
    </StepShell>
  );
}

function StepOntology() {
  // Mini wide-row mockup — one account, a handful of canonical columns,
  // brand-chip provenance per cell. Mirrors the InteractiveZipperedTable
  // above; this is the compact form that lives inside the walkthrough.
  return (
    <StepShell
      num={3}
      wide
      title="Ontology"
      sub="Every account lives on one unified record: sales activity, deal data, news, and meeting notes all in one place. Once every integration is connected, the table view is fully customizable. Pick any combination of columns drawn from any field your tools capture, filter the sources, choose the accounts, sort by any of them."
    >
      <InteractiveZipperedTable />
    </StepShell>
  );
}

function StepRules() {
  return (
    <StepShell
      num={4}
      wide
      title="Rules"
      sub="Build a rule stream from any source: ontology fields, news, meetings, or AI extraction. Chain triggers with AND, then chain actions to run on a hit (Slack DM, Dock workspace, Outreach sequence, asset delivery, snooze, CSM notify). Three urgency tiers route the output: blocking to Slack within the hour, action to the queue, awareness to the weekly roundup."
    >
      <InteractiveSignals />
    </StepShell>
  );
}

function StepActions() {
  return (
    <StepShell
      num={5}
      wide
      title="Actions"
      sub="Every rule lands with a specific next step. Acted, skipped, or snoozed, all logged with the channel used and the observed outcome. Actions feed back into the engine so the next rule is better targeted."
    >
      <InteractiveDecisions />
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
      {/* Mono uppercase tracked label - matches the "STEP 0X / 05" eyebrow
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
// Market intel live preview - surfaces the workspace-wide newsletter inbox
// at the bottom of the landing page so visitors see real intelligence flowing
// (not just the seed-driven Console above). Pulls the freshest five
// workspace-scoped signals from Supabase via the same query /market-intel
// uses. Fails soft to an empty state if the fetch errors so a Supabase
// outage doesn't take down the landing page.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Newsletter transform visual - one big three-panel demo showing a real
// newsletter flowing through Haiku into a dashboard card. Visual + minimal
// text; replaces the prior pipeline funnel (numbers were not telling a
// story) and the dense Haiku-showcase grid (too text-heavy). Everything is
// static markup with one CSS-pulse animation on the Haiku panel dots, no
// JS required.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Data sources row — three cards calling out the upstream feeds that power
// the workspace inbox. AgentMail is the inbox runtime (webhook + signed
// Svix delivery), NewsAPI is the daily news cron, SEC EDGAR is the public
// filings monitor. Sits above the NewsletterTransformVisual so the reader
// sees what's feeding the synthesis before they see the synthesis itself.
// ---------------------------------------------------------------------------

function DataSourcesRow() {
  return (
    <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <SourceCard
        icon="✉"
        name="AgentMail"
        role="Newsletter inbox · Svix-signed webhooks"
        detail="One workspace inbox for every subscribed publisher. AI tags each email by account or vertical."
      />
      <SourceCard
        icon="N"
        name="NewsAPI"
        role="Mainstream press · daily cron"
        detail="Reuters, Bloomberg, TechCrunch. AI grades relevance and routes high-confidence hits to the matching account."
      />
      <SourceCard
        icon="§"
        name="SEC EDGAR"
        role="Public filings · 10-K, 8-K, 6-K"
        detail="Live monitor on tracked public companies. Leadership changes, risk-factor edits, M&A, earnings to the drawer in minutes."
      />
      <SourceCard
        icon="F"
        name="Firecrawl"
        role="Account site scrapes · nightly"
        detail="Newsrooms + leadership + product pages scraped per account. AI extracts earnings dates, conference talks, product launches."
      />
    </div>
  );
}

function SourceCard({
  icon,
  name,
  role,
  detail,
}: {
  icon: string;
  name: string;
  role: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-border bg-foreground/[0.04] text-foreground font-mono font-bold text-sm shrink-0"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{name}</h3>
          <div className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted leading-snug">
            {role}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-foreground/65 leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

function NewsletterTransformVisual() {
  return (
    <div className="mt-10 flex flex-col md:flex-row gap-3 items-stretch">
      <NewsletterPanel />
      <FlowChevron />
      <HaikuProcessPanel />
      <FlowChevron />
      <DashboardSignalPanel />
    </div>
  );
}

function FlowChevron() {
  return (
    <div
      aria-hidden
      className="flex md:items-center justify-center text-muted text-xl shrink-0 rotate-90 md:rotate-0 py-1 md:py-0"
    >
      →
    </div>
  );
}

function NewsletterPanel() {
  return (
    <div className="flex-1 rounded-lg border border-border bg-background p-4 flex flex-col min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
        Newsletter
      </div>
      <div className="mt-3 flex items-center gap-2 min-w-0">
        <div
          aria-hidden
          className="w-8 h-8 rounded bg-foreground/[0.05] flex items-center justify-center text-muted shrink-0"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-4 h-4"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 6 9-6" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] text-muted truncate font-mono">
            digest@eu-ai-office.io
          </div>
          <div className="text-xs font-semibold tracking-tight truncate">
            EU AI Office daily brief
          </div>
        </div>
      </div>
      <div className="mt-3 text-xs italic text-foreground/60 leading-snug line-clamp-4">
        EU AI Office published draft enforcement guidance for general-purpose
        AI providers under Article 56 of the AI Act, with first compliance
        reviews scheduled for Q3...
      </div>
    </div>
  );
}

function HaikuProcessPanel() {
  return (
    <div className="md:w-44 shrink-0 rounded-lg border border-brand/30 bg-brand/[0.04] p-4 flex flex-col items-center justify-center text-center gap-2">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-brand">
        Haiku
      </div>
      <div className="text-[11px] text-foreground/70 leading-snug">
        reads + summarizes + tags
      </div>
      <div aria-hidden className="flex items-center gap-1.5 mt-1">
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse"
          style={{ animationDelay: "400ms" }}
        />
      </div>
    </div>
  );
}

function DashboardSignalPanel() {
  return (
    <div className="flex-1 rounded-lg border border-border bg-foreground/[0.02] p-4 flex flex-col min-w-0">
      <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
        Your dashboard
      </div>
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] py-0.5 px-2 rounded border border-brand/40 bg-brand/10 text-brand">
          SAP
        </span>
        <span className="text-[10px] font-mono uppercase tracking-[0.08em] text-muted">
          Regulatory · EU AI Act
        </span>
      </div>
      <div className="mt-3 text-sm font-medium tracking-tight leading-snug">
        EU AI Office released GPAI enforcement guidance. SAP&apos;s BTP AI
        services likely scoped under Article 56 obligations.
      </div>
      <div className="mt-auto pt-3 text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
        High relevance · just now
      </div>
    </div>
  );
}

// Fetches workspace-scoped signals for the SortableWorkspaceFeed below.
// The sort itself happens client-side (workspace_relevance, occurred_at,
// signal type magnitude); the server just hands the rows down. Fails soft
// to an empty array so a Supabase outage doesn't take down the landing.
async function fetchWorkspaceFeed(): Promise<ExternalSignal[]> {
  try {
    const sinceIso = new Date(
      Date.now() - MARKET_INTEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    return await getWorkspaceSignals(sinceIso, MARKET_INTEL_PREVIEW_LIMIT);
  } catch {
    return [];
  }
}

async function MarketIntelLiveSection() {
  const workspaceSignals = await fetchWorkspaceFeed();

  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-24 border-t border-border">
      <SectionEyebrow>Live newsfeed</SectionEyebrow>
      <h2 className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight max-w-3xl">
        Workspace-wide intel, ranked by relevance.
      </h2>
      <p className="mt-4 text-base text-foreground/70 leading-relaxed max-w-2xl">
        Four pipes in, one feed out. AI classifies every input as it lands:
        account mentions route to the right drawer, market-wide moves bubble
        below.
      </p>

      <DataSourcesRow />

      <NewsletterTransformVisual />

      <div className="mt-12">
        <h3 className="text-sm font-semibold tracking-tight text-foreground/80">
          Mentions of your accounts
        </h3>
        <p className="text-xs text-muted mt-1 max-w-2xl leading-snug">
          AI scans every inbound newsletter for tracked-account names. When
          one hits, it gets summarized and tagged to that account so your AE
          walks in informed.
        </p>
      </div>
      <ClientNewsTicker />

      <div className="mt-12">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-foreground/80">
              Top stories the team should know
            </h3>
            <p className="text-xs text-muted mt-1 max-w-2xl leading-snug">
              High-impact news that doesn&apos;t mention any account by name:
              M&amp;A, regulatory shifts, big-tech moves. Haiku ranks by
              relevance so this stays signal, not noise.
            </p>
          </div>
          <RefreshButton label="Refresh feed" />
        </div>
      </div>
      <SortableWorkspaceFeed signals={workspaceSignals} />

      <div className="mt-10">
        <Link
          href="/market-intel"
          className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
        >
          Open the full market intel feed
          <span aria-hidden>→</span>
        </Link>
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
