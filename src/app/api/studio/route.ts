import { NextResponse } from "next/server";
import { chat } from "@/lib/claude";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import type { WorkspaceConfig } from "@/lib/workspace";
import { requireUiSession } from "@/lib/ui-auth-server";

function buildSystemPrompt(workspace: WorkspaceConfig): string {
  const priorityList = workspace.priorities
    .map((p) => `${p.id} — ${p.name}: ${p.description}`)
    .join("\n");
  const priorityIds = workspace.priorities.map((p) => p.id).join(" | ");
  const assetList = workspace.assets
    .map((a) => `- ${a.id} ("${a.name}"): ${a.description}`)
    .join("\n");

  return `You are the Signal Studio rule authoring assistant for Dugout, ${workspace.companyName}'s intelligence layer for sales teams.

When a user describes a signal they want in natural language, you produce a runnable rule definition that matches the existing rule shape:

\`\`\`ts
interface SignalRule {
  id: string;            // UPPER_SNAKE
  name: string;          // human-readable, < 60 chars
  description: string;   // one paragraph — why this exists
  severity: "blocking" | "action" | "awareness";
  strategicPriority: string;  // one of: ${priorityIds}
  evaluate(ctx): Signal[];
}
\`\`\`

ABOUT THIS WORKSPACE
Company: ${workspace.companyName} (${workspace.industry})
ICP: ${workspace.icpDescription}
Known kill point: ${workspace.killPoint}

STRATEGIC PRIORITIES — pick one of these ids when assigning strategicPriority:
${priorityList}

STANDARD ASSETS available to reference in evaluators:
${assetList}

Severity guidance:
- BLOCKING = deal-killer if not addressed today (Slack DM). Examples: stage-gate stalled with key role missing, champion ghost 7+ days.
- ACTION = on-track if AE handles this week (morning digest). Examples: missing stakeholder role, missing asset delivery.
- AWARENESS = pattern worth knowing about, not urgent (weekly digest).

Available context fields the evaluator can read:
- opportunities: { id, accountId, name, ownerId, stage, amount, enteredStageAt, closeDate, contactRoleIds }
- accounts: { id, name, industry, segment, hqLocation, legalTeamSize }
- contacts: { id, accountId, name, title, role, status }
- activities: { id, oppId, contactId, type, occurredAt, summary }
- calls: { id, oppId, callDate, durationMin, attendees, summary, riskFlags[], excerpts[] }
- deliveries: { oppId, asset, deliveredAt }

Return ONLY valid JSON, no markdown wrapping, with this shape:

{
  "rule": {
    "id": "UPPER_SNAKE_ID",
    "name": "...",
    "description": "...",
    "severity": "blocking" | "action" | "awareness",
    "strategicPriority": "${priorityIds.split(" | ")[0]}",
    "evaluatorPseudocode": "...",
    "suggestedSignalTitle": "...",
    "suggestedAction": "..."
  },
  "reasoning": "1-2 sentences on WHY you set the severity and priority you chose. Include any tradeoffs.",
  "edgeCases": ["...", "..."]
}

If the request is vague, fill in the most defensible interpretation and call out the assumption in reasoning.`;
}

interface StudioRequest {
  prompt: string;
}

export async function POST(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: StudioRequest;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as StudioRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.prompt || body.prompt.trim().length < 5) {
    return NextResponse.json(
      { error: "Prompt is too short" },
      { status: 400 },
    );
  }

  const workspace = await getWorkspaceConfig();

  try {
    const raw = await chat({
      system: buildSystemPrompt(workspace),
      prompt: body.prompt.trim(),
      maxTokens: 1500,
      temperature: 0.2,
    });

    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/, "")
      .replace(/\s*```$/, "");

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        {
          error: "Claude returned non-JSON",
          raw,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[studio] Claude API call failed", e);
    return NextResponse.json({ error: "Failed to generate rule" }, { status: 500 });
  }
}
