import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUiSession } from "@/lib/ui-auth-server";

// GET /api/admin/signal-source/<id>
//
// Returns the persisted source content for an external_signals row whose
// derivation source isn't an email (NewsAPI articles, Firecrawl scrapes, SEC
// 8-K filings). Drives the SourcePreviewModal fallback render path: when a
// signal has no inbound_email_id, the modal fetches this endpoint and renders
// content_md via MarkdownBody.
//
// Newsletter signals also populate source_content_md going forward (for code-
// path uniformity), but the modal still prefers /api/admin/inbound-email/<id>
// for those because the raw HTML iframe is strictly more faithful than the
// markdown stripped from it.
//
// Auth: requireUiSession() — same gate as inbound-email/[id]. Single-tenant
// v1; multi-tenant adds a workspace_id check.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireUiSession();
  if (guard) return guard;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || id.length < 1) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("external_signals")
      .select(
        "id, source_content_md, source_content_kind, source_url, publisher_canonical_name, email_subject, occurred_at, summary",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `lookup failed: ${error.message}` },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!data.source_content_md) {
      return NextResponse.json(
        { error: "no source content stored for this signal" },
        { status: 404 },
      );
    }
    return NextResponse.json({ signal: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
