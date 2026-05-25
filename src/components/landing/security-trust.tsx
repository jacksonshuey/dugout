// Compliance / trust block. Surfaces real security posture from the
// codebase. Plain language, one short sentence per claim, no marketing
// fluff (BUILD_ALIGNMENT principle 8).

interface TrustClaim {
  title: string;
  body: string;
}

const CLAIMS: TrustClaim[] = [
  {
    title: "API keys never reach the browser",
    body: "Credentials encrypted in Supabase Vault. Server-side only.",
  },
  {
    title: "Inbound webhooks are cryptographically verified",
    body: "HMAC signature + 5-min replay window. Bad payloads rejected before any DB write.",
  },
  {
    title: "Database is deny-all by default",
    body: "RLS on every public.* table. A leaked anon key returns 404, not data.",
  },
  {
    title: "Dugout never writes back to your source systems",
    body: "Adapters are read-only. A bug here cannot push a bad CRM update or send an email.",
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
    <div className="bg-background p-4 sm:p-5 space-y-1.5">
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
    </div>
  );
}
