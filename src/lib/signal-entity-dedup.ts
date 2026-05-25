import type { ExternalSignal } from "./external-signals";

// Conservative entity-level dedup: collapse the "same story" reported by
// multiple newsletters without collapsing distinct stories about the same
// entity. Pure module — no I/O.

// 0.6 picked empirically: low enough that "OpenAI raises $40B" and
// "OpenAI closes $40B round" collapse, high enough that "OpenAI raises $X"
// and "OpenAI launches Y" stay separate. Both have the entity in common
// but the action verbs and objects diverge past this threshold.
export const HEADLINE_SIMILARITY_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "will",
  "with",
]);

// Words that look capitalized but aren't real entity starts (sentence-
// initial articles, etc.). Skip them when scanning for the first entity.
const ENTITY_SKIP_LEADERS = new Set(["The", "A", "An"]);

const ENTITY_TOKEN = /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3})\b/g;

export function normalizeEntity(summary: string): string | null {
  ENTITY_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_TOKEN.exec(summary)) !== null) {
    const candidate = match[1].trim();
    const firstWord = candidate.split(/\s+/)[0];
    // A bare "The" or "A" at sentence start isn't an entity. If the match
    // is multi-word starting with one of those, strip the leader and use
    // the rest; if it's a single word, skip it entirely.
    if (ENTITY_SKIP_LEADERS.has(firstWord)) {
      const rest = candidate.slice(firstWord.length).trim();
      if (rest.length === 0) continue;
      return rest.toLowerCase();
    }
    return candidate.toLowerCase();
  }
  return null;
}

export function normalizeHeadline(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(" ");
}

export function jaccardSimilarity(a: string, b: string): number {
  const aSet = new Set(a.split(/\s+/).filter((w) => w.length > 0));
  const bSet = new Set(b.split(/\s+/).filter((w) => w.length > 0));
  if (aSet.size === 0 && bSet.size === 0) return 0;
  let intersection = 0;
  for (const w of aSet) if (bSet.has(w)) intersection++;
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function dedupByEntity(signals: ExternalSignal[]): ExternalSignal[] {
  const survivors: ExternalSignal[] = [];
  const cache: { entity: string | null; headline: string }[] = [];

  for (const sig of signals) {
    const entity = normalizeEntity(sig.summary);
    const headline = normalizeHeadline(sig.summary);

    // Null entity → can't confidently match anything; keep as distinct.
    if (entity === null) {
      survivors.push(sig);
      cache.push({ entity, headline });
      continue;
    }

    let mergedIndex = -1;
    for (let i = 0; i < survivors.length; i++) {
      const prior = cache[i];
      if (prior.entity !== entity) continue;
      if (
        jaccardSimilarity(prior.headline, headline) >=
        HEADLINE_SIMILARITY_THRESHOLD
      ) {
        mergedIndex = i;
        break;
      }
    }

    if (mergedIndex === -1) {
      survivors.push(sig);
      cache.push({ entity, headline });
      continue;
    }

    // Keep the newer occurred_at when collapsing.
    // Guard: if either side is missing/non-string, coercion would produce the
    // string "undefined" which sorts after most ISO timestamps, picking the
    // wrong winner silently. Fall back to keeping the incumbent instead.
    const incumbent = survivors[mergedIndex];
    const sigDate = sig.occurred_at;
    const incDate = incumbent.occurred_at;
    if (
      typeof sigDate === "string" &&
      typeof incDate === "string" &&
      sigDate > incDate
    ) {
      survivors[mergedIndex] = sig;
      cache[mergedIndex] = { entity, headline };
    }
  }

  return survivors;
}
