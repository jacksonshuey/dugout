import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireUiSession } from "@/lib/ui-auth-server";

// GET /api/admin/inbound-email/<id>
//
// Returns the raw inbound email for the source-attribution drawer on
// /market-intel. Fields: id, subject, from_address, from_domain,
// received_at, text_body, html_body.
//
// Auth: requireUiSession() - same gate as the other paid routes (Q7
// resolution in docs/filter-design.md §12).
//
// Per-row authorization (e.g. only the workspace owner can view) is
// explicitly out of scope for v1 - Dugout is single-tenant per HANDOFF.md
// §12. When multi-tenant lands, add a workspace_id check here.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Next 16: params is async (Promise). See AGENTS.md.
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
      .from("inbound_emails")
      .select(
        "id, subject, from_address, from_domain, received_at, text_body, html_body, list_id, publisher_canonical_name",
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
    return NextResponse.json({ email: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
