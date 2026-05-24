// Deterministic stub ranker for /market-intel.
//
// Pure function — no I/O, no clock (Date), no random. The caller passes
// `now` on RankerInput so the result is fully reproducible.
//
// Design doc: /docs/ranker-design.md §7. Comparator order matches the
// I-Rank Q0 resolution:
//   1. account-named FIRST  (account comes before random vertical noise)
//   2. severity tier        (blocking → action → awareness)
//   3. occurred_at desc     (newer wins)
//   4. signal_type alpha    (final deterministic tiebreaker)
//
// This is the same precedence as the Haiku prompt's rubric (§4) so the two
// modes rank identically for the canonical cases.

import type { ExternalSignal, ExternalSignalType } from "./external-signals";
import type {
  AccountKeyword,
  RankedItem,
  RankerInput,
  RankerResult,
  StubReason,
} from "./ranker-types";

// Severity tier mapping (deterministic, no model in the loop). The bands
// map ExternalSignalType → the canonical 3-tier severity scale from
// BUILD_ALIGNMENT #3. Lower number = higher priority.
const SEVERITY_TIER: Record<ExternalSignalType, 0 | 1 | 2> = {
  leadership_change: 0, // → champion_loss (BLOCKING)
  champion_job_change: 0, // → champion_loss (BLOCKING)
  ma_acquisition: 0, // → account_context (BLOCKING elevation)
  layoff: 0, // → account_health_decline (BLOCKING)
  regulatory_action: 0, // → vertical_context (BLOCKING elevation)
  funding_round: 1, // ACTION
  earnings: 1, // ACTION
  competitor_mention: 1, // ACTION
  partnership: 1, // ACTION
  product_launch: 2, // AWARENESS
  press_release: 2, // AWARENESS
  other: 2, // AWARENESS
};

export function severityTierFor(type: ExternalSignalType): 0 | 1 | 2 {
  return SEVERITY_TIER[type] ?? 2;
}

// Match a signal against the workspace's tracked-account keywords. Returns
// the account_ids whose name/ticker/domain_slug appears in the signal's
// `meta.mention` (when present) or summary. Case-insensitive, word-boundary
// match — same shape as newsletter-adapter's matcher so the two paths agree
// on what counts as "this signal names an account."
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mentionTextFor(signal: ExternalSignal): string {
  const meta = (signal.meta ?? {}) as { mention?: unknown };
  const mention =
    typeof meta.mention === "string" ? meta.mention : "";
  // Concatenate the mention and the summary — both are fair game for a
  // name match. The summary catches cases where the newsletter classifier
  // didn't populate meta.mention (older rows, web_scrape source, etc.).
  return normalize(`${mention} ${signal.summary}`);
}

export function matchAccounts(
  signal: ExternalSignal,
  accountKeywords: AccountKeyword[],
): string[] {
  const haystack = mentionTextFor(signal);
  if (haystack.length < 3) return [];
  const matched = new Set<string>();
  for (const acc of accountKeywords) {
    const keywords: string[] = [];
    const nameNorm = normalize(acc.name);
    if (nameNorm.length >= 3) keywords.push(nameNorm);
    if (acc.ticker && acc.ticker.length >= 2) keywords.push(acc.ticker.toLowerCase());
    if (acc.domain_slug && acc.domain_slug.length >= 3) keywords.push(acc.domain_slug.toLowerCase());
    for (const kw of keywords) {
      // Word-boundary check: equal, prefix-with-space, suffix-with-space,
      // or surrounded by spaces. The normalized strings only contain
      // letters/digits/spaces so this is sufficient.
      if (
        haystack === kw ||
        haystack.startsWith(kw + " ") ||
        haystack.endsWith(" " + kw) ||
        haystack.includes(" " + kw + " ")
      ) {
        matched.add(acc.account_id);
        break;
      }
    }
  }
  return [...matched];
}

interface Enriched {
  signal: ExternalSignal;
  severityRank: 0 | 1 | 2;
  accountIds: string[];
  occurredMs: number;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

// Comparator (exact). Order:
//   1. account-named first   (Q0 resolution: account comes before severity)
//   2. severity tier asc
//   3. occurred_at desc
//   4. signal_type alpha
function compareEnriched(a: Enriched, b: Enriched): number {
  const aNamed = a.accountIds.length > 0 ? 0 : 1;
  const bNamed = b.accountIds.length > 0 ? 0 : 1;
  if (aNamed !== bNamed) return aNamed - bNamed;

  if (a.severityRank !== b.severityRank) return a.severityRank - b.severityRank;

  if (a.occurredMs !== b.occurredMs) return b.occurredMs - a.occurredMs;

  return a.signal.type.localeCompare(b.signal.type);
}

// Stub rationales. Templated, always cite the signal id. Kept under 25
// words each (asserted by the bonus test). Voice rules from
// BUILD_ALIGNMENT #8: plain, no exclamation, no emoji, no markdown.
function stubRationale(e: Enriched, accountKeywords: AccountKeyword[]): string {
  const id = e.signal.id;
  const type = e.signal.type;
  if (e.accountIds.length > 0) {
    const acc = accountKeywords.find((k) => k.account_id === e.accountIds[0]);
    const accName = acc?.name ?? e.accountIds[0];
    if (e.severityRank === 0) {
      return `Names ${accName}; ${type} is a blocking-tier deal-stage event. [citation:${id}]`;
    }
    if (e.severityRank === 1) {
      return `Names ${accName}; ${type} warrants follow-up. [citation:${id}]`;
    }
    return `Names ${accName}; ${type} adds account context. [citation:${id}]`;
  }
  if (e.severityRank === 0) {
    return `Vertical-level ${type} worth scanning for adjacent accounts. [citation:${id}]`;
  }
  if (e.severityRank === 1) {
    return `Vertical ${type} signal; consider relevance to your book. [citation:${id}]`;
  }
  return `Background ${type}; flagged for awareness. [citation:${id}]`;
}

export function rankStub(
  input: RankerInput,
  reason: StubReason,
): RankerResult {
  if (input.signals.length === 0) {
    return {
      items: [],
      generated_at: input.now.toISOString(),
      source: "stub",
      stubReason: "empty_input",
      cache_hit: false,
    };
  }

  const enriched: Enriched[] = input.signals.map((s) => {
    const occurredMs = Date.parse(s.occurred_at);
    return {
      signal: s,
      severityRank: severityTierFor(s.type),
      accountIds: matchAccounts(s, input.accountKeywords),
      occurredMs: Number.isFinite(occurredMs) ? occurredMs : 0,
    };
  });

  enriched.sort(compareEnriched);

  const topN = clamp(input.topN ?? 20, 1, 50);
  const sliced = enriched.slice(0, topN);

  const items: RankedItem[] = sliced.map((e, i) => ({
    signal_id: e.signal.id,
    rank: i + 1,
    rationale: stubRationale(e, input.accountKeywords),
    related_account_ids: e.accountIds.length > 0 ? e.accountIds : undefined,
  }));

  return {
    items,
    generated_at: input.now.toISOString(),
    source: "stub",
    stubReason: reason,
    cache_hit: false,
  };
}
