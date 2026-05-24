// Publisher → vertical lookup. Source of truth for canonical names is
// `inbound-publishers.ts`; vertical taxonomy is `docs/newsletters/MASTER.md`
// §1 (the 9-vertical inventory). Pure module — no I/O.

export type NewsletterVertical =
  | "ai-cross-cutting"
  | "enterprise-tech"
  | "legal-tech"
  | "fintech"
  | "healthcare"
  | "insurance"
  | "pharma"
  | "private-equity"
  | "gtm-exec-moves";

// Keyed on `publisher_canonical_name` from inbound-publishers.ts. Only
// canonicals that actually exist in that catalog appear here; new entries
// must land in the catalog first.
const PUBLISHER_VERTICAL: Record<string, NewsletterVertical> = {
  artificial_lawyer: "legal-tech",
  axios_pro_rata: "private-equity",
  // Brainyacts straddles AI + legal; primary tag is legal-tech because the
  // editorial lens is the legal practitioner, not the model researcher.
  brainyacts: "legal-tech",
  cfo_dive: "fintech",
  clouded_judgement: "enterprise-tech",
  endpoints_news: "pharma",
  import_ai: "ai-cross-cutting",
  interconnects: "ai-cross-cutting",
  latent_space: "ai-cross-cutting",
  money_stuff: "fintech",
  pragmatic_engineer: "enterprise-tech",
  runtime: "enterprise-tech",
  // Stratechery (Ben Thompson) is strategy-of-tech more than pure AI —
  // enterprise-tech wins as the primary tag.
  stratechery: "enterprise-tech",
  the_batch: "ai-cross-cutting",
  the_information: "enterprise-tech",
};

// Unknown publishers return null. Callers decide whether to include or
// exclude — we don't fall back to a default vertical because misrouting a
// signal silently is worse than leaving it untagged.
export function verticalFor(
  publisherCanonicalName: string,
): NewsletterVertical | null {
  return PUBLISHER_VERTICAL[publisherCanonicalName] ?? null;
}

export function isTechOrAI(vertical: NewsletterVertical | null): boolean {
  return vertical === "ai-cross-cutting" || vertical === "enterprise-tech";
}
