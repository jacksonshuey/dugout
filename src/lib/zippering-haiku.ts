// Haiku column-routing assessor for the zippering pipeline.
//
//   assessColumnRouting(inputs, client?): Promise<HaikuRoutingVerdict>
//
// Wraps a single Anthropic Haiku call (temperature 0, forced tool_choice)
// that decides whether an incoming integration column should:
//   - JOIN an existing canonical column (global or per-pkey)
//   - APPEND as a new canonical column
//   - UNCLEAR: ambiguous samples, flag for human review
//
// Pattern matches src/lib/email-filter.ts:505-545 exactly:
//   - HAIKU_MODEL string
//   - AbortController + clearTimeout
//   - tool_choice: { type: "tool", name: <tool-name> }
//   - input_schema cast as unknown as Anthropic.Tool.InputSchema
//   - find tool_use block + throw if missing
//
// Design doc: docs/zippering-plan.md §4

import Anthropic from "@anthropic-ai/sdk";

import type {
  GlobalCanonicalColumn,
  HaikuRoutingVerdict,
  ZipperingDataType,
  ZipperingSchemaRow,
} from "./zippering-types";

// Haiku model id — must match email-filter.ts:50.
const HAIKU_MODEL = "claude-haiku-4-5";

// Abort budget for the Anthropic request (ms). Shorter than email-filter.ts
// (8 s vs 15 s) because column routing is on the hot ingest path.
const HAIKU_TIMEOUT_MS = 8_000;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const ROUTING_TOOL_SCHEMA = {
  name: "zippering_routing_verdict",
  description:
    "Decide how an incoming column from an integration should route into the zippered schema for an account.",
  input_schema: {
    type: "object",
    properties: {
      verdict: {
        type: "string",
        enum: ["join", "append", "unclear"],
      },
      canonical_name: {
        type: "string",
        minLength: 1,
      },
      is_global_target: {
        type: "boolean",
      },
      similarity_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      reason: {
        type: "string",
        minLength: 1,
        maxLength: 200,
      },
    },
    required: [
      "verdict",
      "canonical_name",
      "is_global_target",
      "similarity_score",
      "reason",
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AssessInputs {
  pkey: string;
  source: string;
  source_column: string;
  source_data_type: ZipperingDataType;
  source_description?: string;
  source_samples: unknown[];
  candidates_global: GlobalCanonicalColumn[];
  candidates_pkey: ZipperingSchemaRow[];
}

/**
 * Call Haiku to decide how an incoming integration column should be routed.
 *
 * @param inputs  - All signal data Haiku needs: column metadata + both
 *                  candidate tiers (global canonicals first, per-pkey second).
 * @param client  - Injected Anthropic instance. Defaults to `new Anthropic()`
 *                  so production callers need no extra plumbing; tests inject
 *                  a fake client for zero real network calls.
 */
export async function assessColumnRouting(
  inputs: AssessInputs,
  client: Anthropic = new Anthropic(),
): Promise<HaikuRoutingVerdict> {
  const prompt = buildPrompt(inputs);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HAIKU_TIMEOUT_MS);

  try {
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: 256,
        temperature: 0,
        tools: [
          {
            name: ROUTING_TOOL_SCHEMA.name,
            description: ROUTING_TOOL_SCHEMA.description,
            input_schema:
              ROUTING_TOOL_SCHEMA.input_schema as unknown as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: "tool", name: ROUTING_TOOL_SCHEMA.name },
        messages: [{ role: "user", content: prompt }],
      },
      { signal: ac.signal },
    );

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && b.name === ROUTING_TOOL_SCHEMA.name,
    );

    if (!toolUse) {
      throw new Error(
        `Haiku returned no tool_use block for zippering_routing_verdict`,
      );
    }

    return parseVerdict(toolUse.input);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildPrompt(inputs: AssessInputs): string {
  const {
    pkey,
    source,
    source_column,
    source_data_type,
    source_description,
    source_samples,
    candidates_global,
    candidates_pkey,
  } = inputs;

  const descLine =
    source_description && source_description.trim().length > 0
      ? source_description.trim()
      : "(none provided)";

  const samplesLine =
    source_samples.length > 0
      ? source_samples.map((s) => JSON.stringify(s)).join(", ")
      : "(no samples)";

  const globalSection =
    candidates_global.length > 0
      ? candidates_global
          .map((c) => {
            const tags =
              c.semantic_tags.length > 0 ? c.semantic_tags.join(", ") : "—";
            const desc = c.description ?? "(no description)";
            return `  - name: ${c.name}  data_type: ${c.data_type}  description: ${desc}  tags: [${tags}]`;
          })
          .join("\n")
      : "  (none — no global canonicals exist yet)";

  const pkeySection =
    candidates_pkey.length > 0
      ? candidates_pkey
          .map((c) => {
            const desc = c.description ?? "(no description)";
            return `  - canonical_name: ${c.canonical_name}  data_type: ${c.data_type}  description: ${desc}`;
          })
          .join("\n")
      : "  (none — no per-pkey canonicals exist yet)";

  return `You are deciding whether an incoming column from a data integration is semantically the same field as an existing canonical column we already track for an account.

Prefer routing to a GLOBAL canonical when the match is reasonable so we can query across accounts later. Only route to a per-pkey canonical when no global is a good fit. Only APPEND a new column if neither tier matches. Return UNCLEAR when sample values are inconsistent or ambiguous — do not guess; we'll surface for human review.

INCOMING COLUMN
  source:              ${source}
  column_name:         ${source_column}
  source_data_type:    ${source_data_type}
  source_description:  ${descLine}
  sample_values:       ${samplesLine}

GLOBAL CANONICAL COLUMNS (preferred match targets)
${globalSection}

PER-PKEY CANONICAL COLUMNS (fallback match targets — pkey: ${pkey})
${pkeySection}

Rules:
- "join" when the columns carry the same kind of data — set canonical_name to the matching global or per-pkey name.
- "append" when no candidate fits — invent a snake_case name.
- "unclear" when sample values are inconsistent or ambiguous; do not guess. Still set a canonical_name suggestion.
- is_global_target is true only when canonical_name matches an entry in the GLOBAL candidate list.

Call the zippering_routing_verdict tool with your decision.`;
}

function parseVerdict(raw: unknown): HaikuRoutingVerdict {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Haiku tool_use input is not an object: ${JSON.stringify(raw)}`);
  }

  const obj = raw as Record<string, unknown>;

  const verdict = obj["verdict"];
  if (verdict !== "join" && verdict !== "append" && verdict !== "unclear") {
    throw new Error(`Invalid verdict from Haiku: ${JSON.stringify(verdict)}`);
  }

  const canonical_name = obj["canonical_name"];
  if (typeof canonical_name !== "string" || canonical_name.length === 0) {
    throw new Error(
      `Missing or empty canonical_name from Haiku: ${JSON.stringify(canonical_name)}`,
    );
  }

  const is_global_target = obj["is_global_target"];
  if (typeof is_global_target !== "boolean") {
    throw new Error(
      `is_global_target must be boolean, got: ${JSON.stringify(is_global_target)}`,
    );
  }

  const similarity_score = obj["similarity_score"];
  if (
    typeof similarity_score !== "number" ||
    similarity_score < 0 ||
    similarity_score > 1
  ) {
    throw new Error(
      `similarity_score out of range: ${JSON.stringify(similarity_score)}`,
    );
  }

  const reason = obj["reason"];
  if (typeof reason !== "string" || reason.length === 0) {
    throw new Error(`Missing or empty reason from Haiku: ${JSON.stringify(reason)}`);
  }

  return { verdict, canonical_name, is_global_target, similarity_score, reason };
}
