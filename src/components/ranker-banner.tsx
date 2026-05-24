import type { StubReason } from "@/lib/ranker-types";

// Yellow degradation banner for the market-intel ranker.
//
// Shown above the ranked table when the ranker fell back to its
// deterministic stub (any non-empty stubReason). The banner copy matches
// the /ask 429 amber card style (see ask-chat-panel.tsx) so a reader who
// already knows what an /ask amber card means recognises this one
// instantly — same visual, different surface.
//
// Renders null on `empty_input` and when no stubReason is set: the page's
// existing empty state covers the no-signals case, and a successful Haiku
// run shouldn't draw attention to itself.

const REASON_COPY: Record<Exclude<StubReason, "empty_input">, string> = {
  no_api_key:
    "Live ranking unavailable — ANTHROPIC_API_KEY not configured. Showing deterministic fallback ordering by severity tier.",
  haiku_5xx:
    "Live ranking unavailable — Haiku returned a server error. Showing deterministic fallback ordering by severity tier.",
  haiku_timeout:
    "Live ranking unavailable — Haiku exceeded the 15s response budget. Showing deterministic fallback ordering by severity tier.",
  haiku_malformed_json:
    "Live ranking unavailable — Haiku returned an unparseable response. Showing deterministic fallback ordering by severity tier.",
  haiku_schema_violation:
    "Live ranking unavailable — Haiku response failed schema validation. Showing deterministic fallback ordering by severity tier.",
};

export function RankerBanner({ stubReason }: { stubReason?: StubReason }) {
  if (!stubReason || stubReason === "empty_input") return null;
  const copy = REASON_COPY[stubReason];
  return (
    <div className="border border-amber-400 bg-amber-50 rounded-md p-3 text-xs text-amber-900 mb-4">
      <p className="font-medium">Live ranking unavailable</p>
      <p className="mt-0.5">{copy}</p>
    </div>
  );
}
