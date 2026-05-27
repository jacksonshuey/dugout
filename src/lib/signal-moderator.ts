// Signal moderation: GPT-4o pass that runs between the raw Supabase fetch
// and what the AE actually reads.
//
// The core problem is not hallucination — it is summarization precision.
// Haiku collapses nuanced events into slightly too-generic claims:
//
//   "Gilead expanded WHO collaboration" (correct but loses the 5-year
//   visceral leishmaniasis program through 2030)
//
//   "Article 56 obligations" (Article 56 is the Code of Practice mechanism;
//   the actual GPAI provider obligations are Articles 53 and 55)
//
//   Two near-identical rows for the same Lilly/Novo story from one Reuters
//   article picked up by PharmExec and FiercePharma
//
// GPT-4o is used (not mini) because it needs to:
//   1. Re-derive precision from source_content_md when available
//   2. Correctly identify regulatory article numbers
//   3. Recognise secondary-source chains (trade pub → Reuters → press release)
//   4. De-duplicate near-identical signals within a batch
//
// The returned signal objects are identical to the inputs except:
//   - summary is replaced with the moderated version
//   - moderated_confidence is set to one of the four confidence tiers
//   - Signals flagged as duplicates of an earlier signal are removed
//
// Falls back to originals silently on any error or missing key.
// Called server-side only (page.tsx). Never on the hot path.

import { getOpenAIClient } from "./openai";
import type { ExternalSignal } from "./external-signals";

// GPT-4o for this pass — needs the reasoning depth to identify source chains,
// fix regulatory article numbers, and re-derive specifics from source content.
const MODERATOR_MODEL = "gpt-4o";

// Maximum characters of source_content_md to include per signal. Full articles
// can be 10–40k chars; 3k captures the lede, key facts, and attribution chain
// without blowing the context budget on a batch of 5–10 signals.
const MAX_SOURCE_CHARS = 3000;

const SYSTEM_PROMPT = `You are a signal quality editor for a B2B sales intelligence platform.
Sales reps read your output before customer meetings. Precision and source transparency matter more than brevity.

You receive AI-generated news signal summaries, their attributed source, and (when available) the raw source text the summary was derived from.

Your job is to produce a corrected summary and a confidence rating for each signal.

CORRECTION RULES

1. Re-derive precision from source text.
   When source_content is provided, use it to recover specific details the summary collapsed:
   - Named programs, timelines, dollar amounts, article/section numbers, partner names
   - Example: "Gilead expanded WHO collaboration" → "Gilead renewed a five-year collaboration with WHO to eliminate visceral leishmaniasis, including drug donations and funding through 2030"
   - Only add details that are explicitly in source_content. Never invent.

2. Fix regulatory and legal citations.
   - EU AI Act: Article 56 is the voluntary Code of Practice mechanism. Core GPAI provider obligations are Articles 53 (general GPAI models) and 55 (systemic-risk models). Do not say "Article 56 obligations."
   - When correcting a citation you are confident about, use the correct reference. When uncertain, soften to "under the relevant provision."

3. Identify secondary-source chains.
   - If a trade publication (PharmExec, FiercePharma, Law360) is summarizing Reuters, a company press release, or an SEC filing, note the original source: "according to [original source], as reported by [trade pub]"
   - Primary sources: company press releases, SEC filings (8-K, 10-K), official government publications
   - Secondary sources: Reuters, Bloomberg, WSJ, FT
   - Tertiary sources: trade pubs (PharmExec, FiercePharma, Law360, Legal Dive) summarising the above

4. Remove timing overclaims.
   Strip "just released", "announced today", "breaking" unless the source_content explicitly confirms the date matches. Replace with neutral phrasing.

5. Separate confirmed from inferred.
   If the summary mixes a confirmed event with a likely implication, use "suggesting" or "which may indicate" for the inferred portion.

6. Flag near-duplicates.
   If two signals in the batch describe the same underlying event (same company, same story, different trade pub pick-ups), set dedupe_of to the id of the signal to keep (the one with the better source or more detail). The duplicate will be removed from the feed.

7. Keep summaries under 75 words. If the original is already precise and well-attributed, return it unchanged.

CONFIDENCE TIERS

verified_primary   — summary grounded in a company press release, SEC filing, or official government publication
verified_secondary — grounded in Reuters, Bloomberg, WSJ, FT, or equivalent tier-1 outlet
inferred           — trade pub summary of a primary/secondary source; core facts likely accurate but chain is indirect
needs_review       — sourcing unclear, claims imprecise, or no source_content available to verify against

Input: JSON object with a "signals" array of {id, summary, source, source_content?} objects.
Output: JSON object with a "signals" array of {id, summary, confidence, dedupe_of?} objects. No other keys.`;

interface ModerationInput {
  id: string;
  summary: string;
  source: string;
  source_content?: string;
}

interface ModerationOutputItem {
  id: string;
  summary: string;
  confidence: ExternalSignal["moderated_confidence"];
  dedupe_of?: string;
}

interface ModerationOutput {
  signals?: ModerationOutputItem[];
}

// Moderate a batch of signals. Returns a new array with corrected summaries,
// confidence tiers set, and near-duplicates removed.
// Original signal objects are never mutated. Falls back to originals on error.
export async function moderateSignals(
  signals: ExternalSignal[],
): Promise<ExternalSignal[]> {
  if (signals.length === 0) return signals;

  const client = getOpenAIClient();
  if (!client) return signals;

  const input: ModerationInput[] = signals.map((s) => {
    const item: ModerationInput = {
      id: s.id,
      summary: s.summary,
      source: s.publisher_canonical_name ?? s.source,
    };
    // Pass source content so the model can re-derive precision. Truncate to
    // avoid ballooning the batch context budget.
    if (s.source_content_md) {
      item.source_content = s.source_content_md.slice(0, MAX_SOURCE_CHARS);
    }
    return item;
  });

  try {
    const completion = await client.chat.completions.create({
      model: MODERATOR_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ signals: input }) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as ModerationOutput;
    const results = new Map(
      (parsed.signals ?? []).map((r) => [r.id, r]),
    );

    // Build the corrected signal list, stripping deduplicated rows.
    // A signal is a duplicate if dedupe_of points to another signal id
    // that also appears in this batch — meaning the "better" version exists.
    const keptIds = new Set(signals.map((s) => s.id));
    for (const r of parsed.signals ?? []) {
      if (r.dedupe_of && keptIds.has(r.dedupe_of)) {
        // r is the duplicate; r.dedupe_of is the one to keep
        keptIds.delete(r.id);
      }
    }

    return signals
      .filter((s) => keptIds.has(s.id))
      .map((s) => {
        const result = results.get(s.id);
        if (!result) return s;
        return {
          ...s,
          summary: result.summary || s.summary,
          moderated_confidence: result.confidence ?? undefined,
        };
      });
  } catch {
    // Moderation failed — return originals. Raw signal is still better than blank.
    return signals;
  }
}

// Convenience wrapper for the Record<accountId, ExternalSignal[]> shape used
// by the pre-meeting brief. Moderates each account's signals in parallel.
export async function moderateBriefSignals(
  briefSignals: Record<string, ExternalSignal[]>,
): Promise<Record<string, ExternalSignal[]>> {
  const entries = Object.entries(briefSignals);
  if (entries.length === 0) return briefSignals;

  const moderated = await Promise.all(
    entries.map(async ([id, sigs]) => {
      const result = await moderateSignals(sigs);
      return [id, result] as const;
    }),
  );

  return Object.fromEntries(moderated);
}
