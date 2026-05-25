import { NextResponse } from "next/server";
import { requireUiSession } from "@/lib/ui-auth-server";
import { HAS_OPENAI_KEY } from "@/lib/openai";
import { HAS_ANTHROPIC_KEY } from "@/lib/anthropic-ask";

// GET /api/ask/providers - boolean availability of each provider's API key
// in this environment. The /ask UI reads this on mount to grey out
// provider options whose key isn't configured (no need to attempt a
// request just to discover the env var is missing).
//
// Returns:
//   { openai: boolean, anthropic: boolean }
//
// Gated by requireUiSession() to match the rest of /api/* - the public
// shouldn't be able to enumerate which providers we have keys for.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireUiSession();
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    openai: HAS_OPENAI_KEY,
    anthropic: HAS_ANTHROPIC_KEY,
  });
}
