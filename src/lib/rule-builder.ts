import {
  comparatorsFor,
  getFieldSchema,
  groupLabel,
  ONTOLOGY_SCHEMA,
  type Comparator,
  type FieldGroup,
} from "@/data/ontology-schema";
import {
  ACTION_TEMPLATES,
  type Action,
  type ActionKind,
  type RuleDraft,
  type Trigger,
} from "./rule-model";

// Server-side half of the natural-language rule builder. Two jobs:
//   1. buildRuleChatSystemPrompt() — serializes the live ontology schema +
//      the trigger/action contract into a conversational LLM system prompt,
//      so the model can only reference fields/comparators/actions that exist.
//   2. validateRuleDraft() — coerces the model's JSON back into a RuleDraft,
//      dropping anything that doesn't satisfy the schema. The composer then
//      renders whatever survives; the user edits and saves. Tolerant by
//      design: a bad trigger is dropped, not fatal, so a near-miss still
//      lands a usable draft in the UI.

const NEWS_SOURCES = ["SEC EDGAR", "NewsAPI", "AgentMail digest"] as const;
const MEETING_SOURCES = ["Gong", "Granola"] as const;
const AI_EXTRACT_SOURCES = ["email", "meeting", "account summary"] as const;
const ACTION_KINDS: ActionKind[] = [
  "slack_dm_owner",
  "slack_channel",
  "dock_workspace",
  "outreach_sequence",
  "send_asset",
  "calendar_event",
  "snooze",
  "notify_csm",
];

const TWO_NUMBER_COMPARATORS: Comparator[] = ["between", "outside_of"];

// Serialize the live ontology fields + action catalog into the blocks the
// model needs to reference real fields/comparators/actions.
function serializeSchema(): { fieldBlock: string; actionBlock: string } {
  const groups = new Map<FieldGroup, string[]>();
  for (const f of ONTOLOGY_SCHEMA) {
    const comps = comparatorsFor(f.type).join(", ");
    const enums = f.enumValues ? ` | values: ${f.enumValues.join(", ")}` : "";
    const unit = f.unit ? ` | unit: ${f.unit}` : "";
    const line = `- ${f.key} (type: ${f.type}${unit}) — ${f.description}. comparators: ${comps}${enums}`;
    const list = groups.get(f.group) ?? [];
    list.push(line);
    groups.set(f.group, list);
  }
  const fieldBlock = [...groups.entries()]
    .map(([g, lines]) => `### ${groupLabel(g)}\n${lines.join("\n")}`)
    .join("\n\n");

  const actionBlock = ACTION_TEMPLATES.map((t) => {
    const params = Object.keys(t.action).filter((k) => k !== "kind");
    const paramNote = params.length ? ` (params: ${params.join(", ")})` : "";
    return `- ${t.action.kind}${paramNote} — ${t.label}`;
  }).join("\n");

  return { fieldBlock, actionBlock };
}

// Conversational system prompt. The model holds a short back-and-forth with
// the user and, each turn, returns BOTH a natural-language `reply` and an
// optional `rule`. When the request maps onto the supported ontology
// fields/actions it builds the rule; when it asks for something we don't
// track, it does NOT error — it explains briefly and proposes the closest
// supported automation, then asks if the user wants that instead.
export function buildRuleChatSystemPrompt(): string {
  const { fieldBlock, actionBlock } = serializeSchema();

  return `You are Dugout's automation assistant. You help a sales rep turn plain-English ideas into ONE automation rule, conversationally. Keep replies short (1-3 sentences), friendly, and concrete.

Every turn, respond with ONLY a JSON object (no prose, no code fences):
{
  "reply": "<short message to the user>",
  "rule": <rule object, or null>
}

Set "rule" when you can fully express the user's intent with the supported fields and actions below. Otherwise set "rule" to null and use "reply" to either ask a brief clarifying question OR — if they want something Dugout can't do — explain what isn't supported and propose the closest supported automation, ending with a question like "want me to set that up?". NEVER refuse with a bare error; always offer a path forward.

When you include a rule, your reply should one-line summarize it and invite edits (e.g. "Here's a rule that flags stalled six-figure deals and DMs the AE — use it or tell me what to change.").

A rule is { "name", "triggers", "actions" }:
- "name": SCREAMING_SNAKE_CASE label, <= 40 chars (e.g. "STALE_HIGH_VALUE_DEAL").
- "triggers": array joined with AND. Prefer ontology-field triggers for anything expressible as a field comparison. Only use news/meeting/ai_extract for concepts NOT in the field list.
- "actions": array, run in order, at least one.

## Trigger shapes
1. Ontology field:
   { "kind": "ontology", "field": "<field key>", "comparator": "<comparator>", "value": "<string>" }
   - value rules: numeric single comparators -> a number ("5"). between/outside_of -> "lo,hi" ("150000,500000"). enum in/not_in -> comma-joined values exactly from the field's allowed values ("Selected Vendor,Contracting"). contains/ai_matches -> a phrase. Always a STRING.
   - Only use a comparator listed for that field below.
2. News: { "kind": "news", "source": "${NEWS_SOURCES.join("|")}", "mode": "word|ai_semantic", "pattern": "<text>" }
3. Meeting: { "kind": "meeting", "source": "${MEETING_SOURCES.join("|")}", "mode": "word|ai_extract", "pattern": "<text>" }
4. AI extract: { "kind": "ai_extract", "source": "${AI_EXTRACT_SOURCES.join("|")}", "concept": "<what to detect>" }

## Ontology fields (the only data Dugout tracks)
${fieldBlock}

## Actions (the only things a rule can do)
${actionBlock}

## Notifications — never guess the recipient or channel
The only ways to notify anyone are: slack_dm_owner (a Slack DM to the account's AE/owner), slack_channel (post to a named Slack channel), and notify_csm (a hand-off note to the CSM). Every notification goes over Slack — there is no email or SMS, and no way to notify "me"/the current user. So if the user says something vague like "notify me", "alert the team", or "ping someone", DON'T silently pick one — ask which they mean: DM the AE, post to a Slack channel (which one?), or tag the CSM. If they specifically want to notify themselves, explain rules can't target the current user and offer the closest option (usually DM the AE or a channel).

If the user references data we don't track (e.g. NPS score, support tickets, website visits) or an action we can't take (e.g. send a text, create a Jira ticket), that's the redirect case: say so plainly and suggest the nearest supported field/action instead.`;
}

// ---------------------------------------------------------------------------
// Validation — coerce arbitrary parsed JSON into a safe RuleDraft.
// ---------------------------------------------------------------------------

export interface ValidateResult {
  draft: RuleDraft | null;
  warnings: string[];
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function normalizeName(v: unknown): string {
  const s = asString(v)?.trim() ?? "";
  const cleaned = s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return cleaned || "CUSTOM_RULE";
}

function validateOntologyTrigger(
  raw: Record<string, unknown>,
  warnings: string[],
): Trigger | null {
  const field = asString(raw.field);
  const schema = field ? getFieldSchema(field) : undefined;
  if (!field || !schema) {
    warnings.push(`Dropped trigger on unknown field "${field ?? "?"}".`);
    return null;
  }
  const comparator = asString(raw.comparator) as Comparator | null;
  const legal = comparatorsFor(schema.type);
  if (!comparator || !legal.includes(comparator)) {
    warnings.push(`Dropped ${field}: comparator not valid for a ${schema.type} field.`);
    return null;
  }

  let value = asString(raw.value)?.trim() ?? "";

  if (schema.type === "enum") {
    const allowed = schema.enumValues ?? [];
    const picked = value
      .split(",")
      .map((s) => s.trim())
      .filter((s) =>
        allowed.some((a) => a.toLowerCase() === s.toLowerCase()),
      )
      // snap to canonical casing
      .map((s) => allowed.find((a) => a.toLowerCase() === s.toLowerCase())!);
    if (picked.length === 0) {
      warnings.push(`Dropped ${field}: no valid values for this enum.`);
      return null;
    }
    value = [...new Set(picked)].join(",");
  } else if (TWO_NUMBER_COMPARATORS.includes(comparator)) {
    const parts = value.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
      warnings.push(`Dropped ${field}: ${comparator} needs two numbers ("lo,hi").`);
      return null;
    }
    value = `${parts[0]},${parts[1]}`;
  } else if (
    (schema.type === "int" || schema.type === "float") &&
    ["==", "!=", ">", "<", ">=", "<="].includes(comparator)
  ) {
    const n = parseFloat(value);
    if (Number.isNaN(n)) {
      warnings.push(`Dropped ${field}: expected a number.`);
      return null;
    }
    value = String(n);
  }

  return { kind: "ontology", field, comparator, value };
}

function validateTrigger(
  raw: unknown,
  warnings: string[],
): Trigger | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  switch (t.kind) {
    case "ontology":
      return validateOntologyTrigger(t, warnings);
    case "news": {
      const source = NEWS_SOURCES.find((s) => s === t.source) ?? "NewsAPI";
      const mode = t.mode === "ai_semantic" ? "ai_semantic" : "word";
      const pattern = asString(t.pattern)?.trim() ?? "";
      if (!pattern) return null;
      return { kind: "news", source, mode, pattern };
    }
    case "meeting": {
      const source = MEETING_SOURCES.find((s) => s === t.source) ?? "Gong";
      const mode = t.mode === "ai_extract" ? "ai_extract" : "word";
      const pattern = asString(t.pattern)?.trim() ?? "";
      if (!pattern) return null;
      return { kind: "meeting", source, mode, pattern };
    }
    case "ai_extract": {
      const source = AI_EXTRACT_SOURCES.find((s) => s === t.source) ?? "email";
      const concept = asString(t.concept)?.trim() ?? "";
      if (!concept) return null;
      return { kind: "ai_extract", source, concept };
    }
    default:
      return null;
  }
}

function validateAction(raw: unknown): Action | null {
  // The model sometimes returns bare strings ("slack_dm_owner") instead of
  // { kind, ...params } objects — accept both.
  const a: Record<string, unknown> =
    typeof raw === "string"
      ? { kind: raw }
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
  const kind = a.kind as ActionKind;
  if (!ACTION_KINDS.includes(kind)) return null;
  switch (kind) {
    case "slack_dm_owner":
      return { kind: "slack_dm_owner" };
    case "notify_csm":
      return { kind: "notify_csm" };
    case "slack_channel":
      return { kind: "slack_channel", channel: asString(a.channel)?.trim() || "#deals" };
    case "dock_workspace":
      return { kind: "dock_workspace", template: asString(a.template)?.trim() || "CFO Leave-Behind" };
    case "outreach_sequence":
      return { kind: "outreach_sequence", template: asString(a.template)?.trim() || "Champion re-engagement" };
    case "send_asset":
      return { kind: "send_asset", asset: asString(a.asset)?.trim() || "Latest SOC 2 packet" };
    case "calendar_event":
      return { kind: "calendar_event", title: asString(a.title)?.trim() || "Jackson <> account champion" };
    case "snooze": {
      const days = typeof a.days === "number" ? a.days : parseInt(asString(a.days) ?? "", 10);
      return { kind: "snooze", days: Number.isFinite(days) && days > 0 ? days : 7 };
    }
  }
}

export function validateRuleDraft(raw: unknown): ValidateResult {
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return { draft: null, warnings: ["Model did not return a rule object."] };
  }
  const obj = raw as Record<string, unknown>;

  const triggers = Array.isArray(obj.triggers)
    ? obj.triggers
        .map((t) => validateTrigger(t, warnings))
        .filter((t): t is Trigger => t !== null)
    : [];

  if (triggers.length === 0) {
    return {
      draft: null,
      warnings: [
        ...warnings,
        "No valid triggers — try naming a specific field or condition (e.g. deal size, meeting count, stage).",
      ],
    };
  }

  let actions = Array.isArray(obj.actions)
    ? obj.actions.map(validateAction).filter((a): a is Action => a !== null)
    : [];
  if (actions.length === 0) {
    actions = [{ kind: "slack_dm_owner" }];
    warnings.push("No valid action returned — defaulted to DM the AE.");
  }

  return {
    draft: { name: normalizeName(obj.name), triggers, actions },
    warnings,
  };
}
