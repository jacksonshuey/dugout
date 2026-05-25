import { NextResponse, type NextRequest } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import {
  checkHealth,
  isTrackedBrand,
} from "@/lib/integration-health";

// GET /api/health/<brand>
//
// Per-integration configuration health. Same checks the landing page server-
// renders, but pulled out as a JSON endpoint so future in-product surfaces
// (an "Integrations" settings page, a status widget on /console) can read
// the same source of truth without re-implementing env-var logic.
//
// Auth: requireUiSession() - same gate as the rest of /api/*. The shape of
// the response is benign on its own ("ANTHROPIC_API_KEY missing" doesn't
// expose anything that's not in .env.example), but enumeration of which
// integrations a deployment has connected is workspace-private info, so
// we keep it behind the same cookie.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ brand: string }> },
) {
  const guard = await requireUiSession();
  if (guard) return guard;

  const { brand } = await ctx.params;
  if (!brand || typeof brand !== "string") {
    return NextResponse.json({ error: "brand required" }, { status: 400 });
  }

  if (!isTrackedBrand(brand)) {
    return NextResponse.json(
      { error: `Unknown brand: ${brand}` },
      { status: 404 },
    );
  }

  const health = checkHealth(brand);
  return NextResponse.json({
    brand,
    mode: health.mode,
    note: health.note,
    ok: health.mode !== "missing",
  });
}
