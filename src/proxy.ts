// Next 16 Proxy (formerly Middleware). Seeds the UI session cookie on the
// first page request so that subsequent client-side calls to the protected
// API routes (digest, studio, slack, external-signals) carry it.
//
// Matcher excludes /api so this never runs on the API itself — auth is
// checked inside each route handler, which the Next docs explicitly call
// out as the correct pattern (proxy is not a substitute for in-handler
// auth, especially for server actions which can be moved between routes).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { mintUiSessionToken, UI_SESSION_COOKIE_NAME } from "@/lib/ui-auth";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  if (req.cookies.get(UI_SESSION_COOKIE_NAME)) return res;

  const token = await mintUiSessionToken();
  if (!token) return res; // secret missing — API routes will 500 with a clear error

  res.cookies.set({
    name: UI_SESSION_COOKIE_NAME,
    value: token,
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR,
  });
  return res;
}

export const config = {
  matcher: [
    // All paths except API routes and Next internals.
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
