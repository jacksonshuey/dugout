// Compliance / trust block. Surfaces real security posture that's already
// in the codebase but invisible to anyone reading the marketing page.
// Every claim here points at code a reviewer can verify.
//
// Voice: plain, opinionated, no marketing fluff (BUILD_ALIGNMENT principle 8).
// Each claim leads with the constraint, then the consequence.

const GITHUB_BASE = "https://github.com/jacksonshuey/dugout/blob/main";

interface TrustClaim {
  title: string;
  body: string;
  evidence: { label: string; href: string };
}

const CLAIMS: TrustClaim[] = [
  {
    title: "API keys never reach the browser",
    body: "Credentials encrypted in Supabase Vault. Server-side only; never in client bundles or logs.",
    evidence: {
      label: "Vault migration",
      href: `${GITHUB_BASE}/supabase/migrations/20260523_granola_integration.sql`,
    },
  },
  {
    title: "Inbound webhooks are cryptographically verified",
    body: "HMAC signature with a 5-min replay window. Unsigned or tampered payloads rejected before any DB write.",
    evidence: {
      label: "Inbound route",
      href: `${GITHUB_BASE}/src/app/api/inbound-email/agentmail/route.ts`,
    },
  },
  {
    title: "Database is deny-all by default",
    body: "RLS on every public.* table. Anon role can do nothing; a leaked anon key gets a 404, not data.",
    evidence: {
      label: "RLS posture",
      href: `${GITHUB_BASE}/supabase/migrations`,
    },
  },
  {
    title: "Dugout never writes back to your source systems",
    body: "Adapters only read from your stack. A bug here produces a wrong signal; it cannot push a bad CRM update or send an unintended email.",
    evidence: {
      label: "Principle 9",
      href: `${GITHUB_BASE}/orgs/_default/BUILD_ALIGNMENT.md`,
    },
  },
];

export function SecurityTrust() {
  return (
    <div className="grid md:grid-cols-2 gap-px bg-border rounded-xl overflow-hidden border border-border">
      {CLAIMS.map((claim) => (
        <ClaimCard key={claim.title} claim={claim} />
      ))}
    </div>
  );
}

function ClaimCard({ claim }: { claim: TrustClaim }) {
  return (
    <div className="bg-background p-5 sm:p-6 space-y-2">
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="mt-1.5 w-1.5 h-1.5 rounded-full bg-severity-green shrink-0"
        />
        <h3 className="text-sm sm:text-base font-semibold tracking-tight leading-snug">
          {claim.title}
        </h3>
      </div>
      <p className="text-sm text-foreground/75 leading-relaxed pl-4">
        {claim.body}
      </p>
      <div className="pl-4 pt-1">
        <a
          href={claim.evidence.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-muted hover:text-brand transition-colors"
        >
          <span aria-hidden>→</span> {claim.evidence.label}
        </a>
      </div>
    </div>
  );
}
