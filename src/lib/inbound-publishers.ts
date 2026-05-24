// Publisher lookup for inbound emails.
//
// The same publication can route through multiple sender domains (Endpoints
// uses endpts.com AND endpointsnews.com AND Campaign Monitor relays).
// `publisher_canonical_name` is the join key the rest of the pipeline reads;
// `display_name` is what the UI shows.
//
// Lookup order:
//   1. List-ID exact match (RFC-2919; e.g. "<axios-pro-rata.axios.com>")
//   2. Sender-domain exact match
//   3. Sender-domain suffix match (subdomains)
//   4. Fallback: { is_known: false, canonical = sender_domain }
//
// Pure module — no I/O. Adding a new publisher = one entry in the map.
// Design doc: /docs/filter-design.md §9 + §11.
//
// v1 catalog covers the Phase 0/1 newsletters from
// docs/newsletters/MASTER.md §3. Bigger catalog ships as RevOps adds
// subscriptions; this list grows organically.

import type { PublisherInfo } from "./email-filter-types";

interface PublisherEntry {
  canonical: string;
  display: string;
  source_url_origin?: string;
  // Any of these strings (lowercased) matches: list-id contents, sender
  // domain, or sender-domain suffix.
  list_ids?: string[];
  sender_domains?: string[];
}

// Hand-curated publisher catalog. Keep ordered alphabetically by canonical
// name for human review. List-IDs are the authoritative match when present;
// sender domains are the fallback when a publisher doesn't ship a List-ID.
const PUBLISHERS: PublisherEntry[] = [
  {
    canonical: "artificial_lawyer",
    display: "Artificial Lawyer",
    source_url_origin: "https://www.artificiallawyer.com",
    sender_domains: ["artificiallawyer.com"],
  },
  {
    canonical: "axios_pro_rata",
    display: "Axios Pro Rata",
    source_url_origin: "https://www.axios.com",
    list_ids: ["axios-pro-rata.axios.com"],
    sender_domains: ["axios.com"],
  },
  {
    canonical: "brainyacts",
    display: "Brainyacts",
    source_url_origin: "https://www.brainyacts.com",
    sender_domains: ["brainyacts.com", "brainyacts.beehiiv.com"],
  },
  {
    canonical: "cfo_dive",
    display: "CFO Dive",
    source_url_origin: "https://www.cfodive.com",
    sender_domains: ["industrydive.com", "cfodive.com"],
  },
  {
    canonical: "clouded_judgement",
    display: "Clouded Judgement",
    source_url_origin: "https://cloudedjudgement.substack.com",
    sender_domains: ["cloudedjudgement.substack.com"],
  },
  {
    canonical: "endpoints_news",
    display: "Endpoints News",
    source_url_origin: "https://endpts.com",
    list_ids: ["endpoints-news.endpts.com"],
    sender_domains: ["endpts.com", "endpointsnews.com"],
  },
  {
    canonical: "import_ai",
    display: "Import AI",
    source_url_origin: "https://importai.substack.com",
    sender_domains: ["importai.substack.com"],
  },
  {
    canonical: "interconnects",
    display: "Interconnects",
    source_url_origin: "https://www.interconnects.ai",
    sender_domains: ["interconnects.ai"],
  },
  {
    canonical: "latent_space",
    display: "Latent Space",
    source_url_origin: "https://www.latent.space",
    sender_domains: ["latent.space"],
  },
  {
    canonical: "money_stuff",
    display: "Money Stuff",
    source_url_origin: "https://www.bloomberg.com",
    sender_domains: ["bloombergbusiness.com", "bloomberg.com"],
  },
  {
    canonical: "pragmatic_engineer",
    display: "The Pragmatic Engineer",
    source_url_origin: "https://newsletter.pragmaticengineer.com",
    sender_domains: ["pragmaticengineer.substack.com", "newsletter.pragmaticengineer.com"],
  },
  {
    canonical: "runtime",
    display: "Runtime",
    source_url_origin: "https://www.runtime.news",
    sender_domains: ["runtime.news"],
  },
  {
    canonical: "the_batch",
    display: "The Batch",
    source_url_origin: "https://www.deeplearning.ai/the-batch",
    sender_domains: ["deeplearning.ai"],
  },
  {
    canonical: "the_information",
    display: "The Information",
    source_url_origin: "https://www.theinformation.com",
    sender_domains: ["theinformation.com"],
  },
];

// Normalize a List-ID header value. RFC-2919 format is
// "Optional description <list-id-text>" — we want the inner token,
// lowercased.
function normalizeListId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const angle = raw.match(/<([^>]+)>/);
  return (angle ? angle[1] : raw).trim().toLowerCase() || null;
}

function normalizeDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.trim().toLowerCase() || null;
}

export function resolvePublisher(args: {
  list_id?: string | null;
  sender_domain: string;
}): PublisherInfo {
  const listId = normalizeListId(args.list_id);
  const senderDomain = normalizeDomain(args.sender_domain) ?? "";

  // 1. List-ID exact match (highest signal).
  if (listId) {
    for (const p of PUBLISHERS) {
      if (p.list_ids?.some((id) => id.toLowerCase() === listId)) {
        return {
          publisher_canonical_name: p.canonical,
          display_name: p.display,
          source_url_origin: p.source_url_origin,
          is_known: true,
        };
      }
    }
  }

  // 2. Sender-domain exact match.
  for (const p of PUBLISHERS) {
    if (p.sender_domains?.some((d) => d.toLowerCase() === senderDomain)) {
      return {
        publisher_canonical_name: p.canonical,
        display_name: p.display,
        source_url_origin: p.source_url_origin,
        is_known: true,
      };
    }
  }

  // 3. Sender-domain suffix match (subdomains like
  //    "newsletters.endpts.com" → "endpts.com").
  for (const p of PUBLISHERS) {
    if (
      p.sender_domains?.some((d) => senderDomain.endsWith(`.${d.toLowerCase()}`))
    ) {
      return {
        publisher_canonical_name: p.canonical,
        display_name: p.display,
        source_url_origin: p.source_url_origin,
        is_known: true,
      };
    }
  }

  // 4. Fallback: degenerate "unknown" entry. `canonical` reuses the sender
  //    domain so audit + dedup queries still group correctly.
  return {
    publisher_canonical_name: senderDomain,
    display_name: senderDomain,
    is_known: false,
  };
}

// Display-name lookup for an already-known canonical name. Used by the UI
// when reading rows that only carry `publisher_canonical_name`. Falls back
// to the canonical name itself (already a reasonable label since unknowns
// store the sender domain).
export function displayNameFor(canonical: string): string {
  const hit = PUBLISHERS.find((p) => p.canonical === canonical);
  return hit?.display ?? canonical;
}
