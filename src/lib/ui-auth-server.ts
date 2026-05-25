// Server-context helpers for UI session auth. Split from ui-auth.ts so the
// proxy (which can't import `next/headers`) can still consume the crypto
// primitives.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  UI_SESSION_COOKIE_NAME,
  verifyUiSessionToken,
} from "./ui-auth";

// Route handler guard. Returns null if the request is authorized, or a
// NextResponse to return immediately.
export async function requireUiSession(): Promise<NextResponse | null> {
  const c = await cookies();
  const token = c.get(UI_SESSION_COOKIE_NAME)?.value;
  const failure = await verifyUiSessionToken(token);
  if (failure) {
    return NextResponse.json(
      { error: failure.message },
      { status: failure.status },
    );
  }
  return null;
}

// Server action guard. Throws on failure - Next propagates the error to the
// client. The message is intentionally generic.
export async function requireUiSessionAction(): Promise<void> {
  const c = await cookies();
  const token = c.get(UI_SESSION_COOKIE_NAME)?.value;
  const failure = await verifyUiSessionToken(token);
  if (failure) {
    throw new Error(failure.message);
  }
}
