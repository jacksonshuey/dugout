// Stage 1: deterministic news content filter rules.
//
// Pure function, no I/O. Runs before the Stage 2 Haiku gate so the cheap
// rejections (domain blacklist, title regex, length sanity) short-circuit
// without paying for a model call.
//
// Design intent: the current news-adapter ingest produces ~80% garbage in
// production (lifestyle, sports, listicles, weather, entertainment). Stage 1
// is the cheap first pass that removes the obvious noise; Stage 2 (Haiku)
// adjudicates the borderline cases.
//
// The blacklists below are STARTER SETS sourced from the production
// diagnostic sample. They will grow as we observe more noise in production —
// add new entries here rather than scattering them across the codebase.
//
// All constants exported so tests + RevOps tuning passes import the exact
// value rather than re-typing it.

import type { ArticleInput, Stage1Result } from "./news-filter-types";

// ─── Domain blacklist ─────────────────────────────────────────────────────
//
// Source domains whose articles are rejected outright. Grouped by failure
// mode so the reasons are auditable and the list is easy to grow.

export const DOMAIN_BLACKLIST: ReadonlySet<string> = new Set<string>([
  // Fashion / lifestyle — pure consumer noise, never sales-intel relevant
  "stylebyemilyhenderson.com",

  // Sports — match results, line-ups, transfer rumors
  "football-italia.net",
  "espn.com",
  "cnn.com/sport",

  // General-interest junk — photo galleries, "weekend reads"
  "streetartutopia.com",

  // Payments-trade noise — high-volume "weekender" digests + sponsor blurbs
  // that mention companies in passing but carry no signal
  "pymnts.com",
  "businessnewsthisweek.com",

  // Regional / general news — too broad; rarely tied to the account
  "abc.net.au",

  // Developer-content farms — auto-generated, no editorial weight
  "c-sharpcorner.com",

  // Weather — never sales-relevant
  "weather.com",

  // Entertainment / celebrity tabloid
  "eonline.com",
  "tmz.com",

  // Auto-generated stock blurbs — high recall on tickers, near-zero signal
  "marketwatch.com",
  "nasdaq.com",
]);

// ─── Title regex blacklist ────────────────────────────────────────────────
//
// Titles matching any of these patterns are rejected. Patterns are
// case-insensitive and tagged so the audit row records which sub-rule fired.

export const TITLE_REJECT_PATTERNS: Array<{ re: RegExp; tag: string }> = [
  // PYMNTS "The Weekender" digest pattern (matches even if domain isn't blacklisted)
  { re: /^the weekender\b/i, tag: "the_weekender" },

  // Lifestyle: packing, "my favorite", weekend guides
  {
    re: /\b(?:my favorite|things to wear|packing tips|weekend.{0,30}guide)\b/i,
    tag: "lifestyle",
  },

  // Sports league prefixes — match results, fixtures
  {
    re: /^(?:nfl|nba|nhl|mlb|fifa|uefa|premier league|serie a|champions league)\b/i,
    tag: "sports_league",
  },

  // Pre-match coverage
  {
    re: /^(?:probable line-ups|line-ups|fixture)\b/i,
    tag: "sports_fixtures",
  },

  // Listicle pattern: "12 Photos", "7 Things", "5 Ways"
  {
    re: /^\d+ (?:photos|things|reasons|ways|tips|hacks)\b/i,
    tag: "listicle",
  },

  // Horoscopes / astrology
  { re: /\b(?:horoscope|astrology|zodiac)\b/i, tag: "astrology" },

  // Recipes / cooking
  { re: /\b(?:recipe|recipes|cooking)\b/i, tag: "recipe" },

  // Weddings / engagements
  {
    re: /\b(?:wedding|engagement ring|honeymoon)\b/i,
    tag: "wedding",
  },
];

// ─── Title length / verb sanity ───────────────────────────────────────────
//
// A title shorter than this is almost always malformed (truncated, missing,
// or a bare entity name from a malformed feed row).
export const MIN_TITLE_LENGTH = 12;

// If a title is ≤ 3 words AND contains none of these verbs, it is rejected
// as "entity name only" (e.g. "Acme Corporation", "Microsoft Bing"). The
// verb list is intentionally tight — these are the verbs that signal an
// actual news event vs. a passing mention. Grow with production data.
export const NEWS_EVENT_VERBS: ReadonlySet<string> = new Set<string>([
  "raises",
  "acquires",
  "launches",
  "files",
  "cuts",
  "announces",
  "appoints",
  "merges",
  "exits",
  "warns",
  "wins",
  "loses",
]);
export const MAX_WORDS_FOR_VERB_CHECK = 3;

// ─── Entry ────────────────────────────────────────────────────────────────

export function stage1Filter(article: ArticleInput): Stage1Result {
  const title = (article.title ?? "").trim();
  const sourceDomain = (article.source_domain ?? "").trim().toLowerCase();
  const sourceName = (article.source_name ?? "").trim();

  // ── No source identity — malformed NewsAPI row ─────────────────────────
  if (sourceName.length === 0 && sourceDomain.length === 0) {
    return {
      verdict: "rejected",
      reason: "Article has no source_name and no source_domain",
      rule: "no_source_identity",
    };
  }

  // ── Domain blacklist (cheapest hash lookup, runs first) ────────────────
  if (DOMAIN_BLACKLIST.has(sourceDomain)) {
    return {
      verdict: "rejected",
      reason: `Source domain ${sourceDomain} is on the noise blacklist`,
      rule: `domain_blacklist:${sourceDomain}`,
    };
  }

  // ── Title length sanity ────────────────────────────────────────────────
  if (title.length < MIN_TITLE_LENGTH) {
    return {
      verdict: "rejected",
      reason: `Title length ${title.length} below minimum ${MIN_TITLE_LENGTH}`,
      rule: "title_too_short",
    };
  }

  // ── Title regex blacklist ──────────────────────────────────────────────
  for (const { re, tag } of TITLE_REJECT_PATTERNS) {
    if (re.test(title)) {
      return {
        verdict: "rejected",
        reason: `Title matches ${tag} pattern`,
        rule: `title_${tag}_pattern`,
      };
    }
  }

  // ── Entity-name-only check (very short title without a news verb) ──────
  const words = title.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= MAX_WORDS_FOR_VERB_CHECK) {
    const hasVerb = words.some((w) =>
      NEWS_EVENT_VERBS.has(w.toLowerCase().replace(/[^a-z]/g, "")),
    );
    if (!hasVerb) {
      return {
        verdict: "rejected",
        reason: `Title is ${words.length} words with no news verb (likely entity name only)`,
        rule: "title_entity_name_only",
      };
    }
  }

  // ── Pass-through default ───────────────────────────────────────────────
  return {
    verdict: "passed",
    reason: "no stage1 rules matched",
    rule: "passthrough",
  };
}
