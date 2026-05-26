import { LiveZipperingDemo } from "@/components/landing/live-zippering-demo";
import { InteractiveZipperedTable } from "@/components/landing/interactive-zippered-table";

// 90-day plan section. Lives at /plan (no longer on the landing page).
//
// The thesis: every integration in the matrix gets wired through the
// zipperer — Haiku-driven schema reconciliation that decides, per incoming
// column, whether to join into an existing canonical column on the account
// pkey or append a new one. Adapters become thin (~20 lines: pkey + raw
// row). No per-integration schema design. Phase 0 of zippering is live in
// production; the 90 days is the adapter buildout it unlocks.
//
// Content rules:
// - Real integration names. The ledger is the spine.
// - No phase narratives, no week-by-week, no aspirational metrics.
// - Numbers are countable: integrations zippered, ontology decisions cached.

export function NinetyDayVision() {
  return (
    <section
      id="ninety-day-plan"
      className="relative border-b border-border bg-background"
    >
      <div className="max-w-6xl mx-auto px-6 py-20 sm:py-24">
        <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.05] max-w-3xl">
          Every integration.
          <br />
          One ontology.
        </h2>

        <ZipperingExplainer />
        <LiveZipperingDemo />
        <InteractiveZipperedTable />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Zippering explainer — two paragraphs. Mechanism, then why the adapter
// buildout is fast.
// ---------------------------------------------------------------------------

function ZipperingExplainer() {
  return (
    <div className="mt-8 max-w-3xl">
      <p className="text-base sm:text-lg text-foreground/75 leading-relaxed">
        Every integration speaks its own schema. Salesforce, Gong, HubSpot,
        and Outreach all carry many of the same fields under different names.
        AI (Anthropic&apos;s Haiku model) reads each incoming column, matches
        it against the canonical columns we already track for the account,
        and routes it. Same data, one shape.{" "}
        <span className="text-foreground font-medium">
          Over the 90 days every company-specific integration gets mapped
          through the zipper method that&apos;s already live.
        </span>{" "}
        Below is a visualization of how we use the zipper method to join
        data sources.
      </p>
    </div>
  );
}

