import { OnboardSearch } from "./_components/onboard-search";

// Customer onboarding search. Type a company name, see (1) existing tracked
// accounts that match and (2) external candidates from Clearbit Autocomplete
// you can add to your session. Session-only — added accounts live in your
// browser's localStorage and never reach the server. Closing the tab does
// not lose them; clearing site data does.

export const metadata = {
  title: "Onboard a customer · Dugout",
};

export default function OnboardPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="text-xs uppercase tracking-[0.2em] font-mono text-muted">
        <span className="text-brand mr-2" aria-hidden>
          →
        </span>
        Onboard a customer
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Find a company. Click integrate.
      </h1>
      <p className="mt-3 text-sm text-foreground/70 leading-relaxed max-w-2xl">
        Type a company name. Already-tracked companies surface first.
        Everything else comes from a public company directory — clicking{" "}
        <span className="font-mono text-foreground/90">Integrate</span> mints
        a primary key for that account. That key is the join across every
        integration the company has: Granola transcripts, SEC filings,
        AgentMail newsletters, Firecrawl scrapes. We call the consolidation
        of those signals into a single account view{" "}
        <span className="text-brand font-medium">zippering</span> — and the
        pkey is the thread.
      </p>
      <p className="mt-2 text-xs text-muted leading-relaxed max-w-2xl">
        Session-only: integrations created here live in this browser.
        Production onboarding writes to Supabase with a UUID pkey
        (gen_random_uuid).
      </p>

      <div className="mt-8">
        <OnboardSearch />
      </div>
    </div>
  );
}
