import { NextResponse } from "next/server";
import {
  accounts,
  activities,
  assetDeliveries,
  calls,
  contacts,
  opportunities,
  reps,
} from "@/data/seed";
import { signalsForRep, sortSignals } from "@/lib/signal-engine";
import { chat } from "@/lib/claude";
import { formatCurrency, daysBetween, lookupBy } from "@/lib/utils";
import type { Signal } from "@/lib/types";
import { getWorkspaceConfig } from "@/lib/workspace-server";
import type { WorkspaceConfig } from "@/lib/workspace";
import {
  getWorkspaceSignals,
  type ExternalSignal,
} from "@/lib/external-signals";
import { requireUiSession } from "@/lib/ui-auth-server";

// The morning digest synthesizer. The signal engine produces structured
// signals; this endpoint serializes them into the prompt context Claude
// needs to write a 60–90 second briefing in the rep's voice.
//
// The workspace config (cookie-loaded) supplies the company-specific shape:
// ICP, kill point, strategic priorities, and asset names. This is what makes
// the digest read as "for your team" rather than generic SaaS slop.

function buildSystemPrompt(workspace: WorkspaceConfig): string {
  const assetList = workspace.assets
    .map((a) => `- "${a.name}" — ${a.description}`)
    .join("\n");
  const priorityList = workspace.priorities
    .map((p) => `- ${p.id} · ${p.name}: ${p.description}`)
    .join("\n");

  return `You are Dugout, the morning digest writer for ${workspace.companyName} AEs.

ABOUT THIS WORKSPACE
Company: ${workspace.companyName} (${workspace.industry})
ICP: ${workspace.icpDescription}
Known kill point: ${workspace.killPoint}

STRATEGIC PRIORITIES
${priorityList}

STANDARD ASSETS (use these names verbatim when referencing assets)
${assetList}

GTM stack: CRM=${workspace.stack.crm}, conversation intelligence=${workspace.stack.conversationIntelligence}, sales engagement=${workspace.stack.salesEngagement}, deal rooms=${workspace.stack.dealRooms}.

YOUR JOB
Write a 60–90 second morning digest the rep will actually read on their phone. Not a report. A briefing.

VOICE AND RULES
- Address the rep by first name once at the top. Then drop into pure substance.
- Lead with what's BLOCKING. One action, named asset, today.
- Group the rest as ACTION items — each with the specific account, the specific gap, the specific next move.
- Skip awareness items unless they are surprising.
- Reference asset names from the list above verbatim. Reference priorities by their name when it sharpens the why.
- If a MARKET INTELLIGENCE block is provided, add a short "### Market intel" section at the end. One bullet per item. Skip the section entirely if nothing is materially relevant to this rep's book. Never lead with market intel — it follows the deal-specific work.
- No filler. No "Here's your morning digest" intros. Get to the work.
- Format: markdown with ### headers ("### Blocking", "### Action", optionally "### Market intel"), bullets under each.
- Total length: 150–250 words.

Do NOT invent signals, deals, or facts not in the structured context. If you're tempted to add color, don't.`;
}

// Render workspace-scoped market intel signals (account_id =
// WORKSPACE_ACCOUNT_ID) for the prompt. Returns an empty string when no
// items qualify so the prompt stays clean.
const MARKET_INTEL_LOOKBACK_DAYS = 7;
const MARKET_INTEL_MAX_ITEMS = 8;

function describeMarketSignal(s: ExternalSignal): string {
  const dateOnly = s.occurred_at.slice(0, 10);
  const sender =
    (s.meta && typeof s.meta === "object" && "sender_domain" in s.meta
      ? String((s.meta as Record<string, unknown>).sender_domain)
      : null) ?? "newsletter";
  return `- [${s.type}] ${s.summary} (${sender}, ${dateOnly})`;
}

async function fetchMarketIntelBlock(): Promise<string> {
  try {
    const since = new Date(
      Date.now() - MARKET_INTEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const signals = await getWorkspaceSignals(since, MARKET_INTEL_MAX_ITEMS);
    if (signals.length === 0) return "";
    return `\n\nMARKET INTELLIGENCE (workspace-wide, past ${MARKET_INTEL_LOOKBACK_DAYS} days):\n${signals.map(describeMarketSignal).join("\n")}`;
  } catch (e) {
    // Supabase unreachable or table missing — non-fatal. The digest still
    // works without the market intel block; the rep just doesn't get one.
    console.warn(
      "[digest] market intel fetch failed (continuing without)",
      e instanceof Error ? e.message : String(e),
    );
    return "";
  }
}

interface DigestRequest {
  repId: string;
}

function describeSignal(s: Signal): string {
  const opp = lookupBy(opportunities, s.oppId, "opportunity");
  const acc = lookupBy(accounts, opp.accountId, "account");
  return `[${s.severity.toUpperCase()}] ${acc.name} (${opp.stage}, ${formatCurrency(opp.amount)}, ${daysBetween(opp.enteredStageAt)}d in stage)
  Signal: ${s.title}
  Detail: ${s.body}
  Suggested action: ${s.suggestedAction}${s.assetLink ? `\n  Linked asset: ${s.assetLink}` : ""}`;
}

export async function POST(req: Request) {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  let body: DigestRequest;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json(
        { error: "Body must be a JSON object" },
        { status: 400 },
      );
    }
    body = parsed as DigestRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rep = reps.find((r) => r.id === body.repId);
  if (!rep) {
    return NextResponse.json({ error: "Unknown repId" }, { status: 400 });
  }

  const workspace = await getWorkspaceConfig();

  const signals = sortSignals(
    signalsForRep(
      {
        opportunities,
        accounts,
        contacts,
        activities,
        calls,
        deliveries: assetDeliveries,
        reps,
        config: {
          companyName: workspace.companyName,
          assets: workspace.assets,
          stack: workspace.stack,
          contractIdleAmountFloor: workspace.contractIdleAmountFloor,
        },
      },
      rep.id,
    ),
  );

  if (signals.length === 0) {
    return NextResponse.json({
      digest: `### All clear\n\n${rep.name.split(" ")[0]}, no blocking or action signals on your book this morning. Use the time to multithread your largest open deal.`,
    });
  }

  const marketIntelBlock = await fetchMarketIntelBlock();

  const userPrompt = `Rep: ${rep.name}
As-of: 2026-05-21 (Wednesday)

SIGNALS (sorted by severity):
${signals.map(describeSignal).join("\n\n")}${marketIntelBlock}

Write ${rep.name.split(" ")[0]}'s morning digest now.`;

  try {
    const digest = await chat({
      system: buildSystemPrompt(workspace),
      prompt: userPrompt,
      maxTokens: 800,
      temperature: 0.3,
    });
    return NextResponse.json({ digest, signalCount: signals.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
