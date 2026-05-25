// UI session token - defends paid/side-effectful API routes from random URL
// probing and bot crawlers.
//
// Threat model: an attacker who only has the public Vercel URL. Without auth,
// they can drain the Anthropic budget by hammering /api/digest, spam the
// configured Slack channel via /api/slack, or enumerate account names via
// /api/external-signals. This module makes every API call require a cookie
// that's seeded by the proxy on the first page load - so calling the API
// without first having loaded the UI is rejected.
//
// This is NOT real auth. It's the minimal gate that closes the "share the
// URL" attack surface. Real per-user auth would be a separate layer.
//
// Pattern mirrors CRON_SECRET in /api/cron/external-signals: fail-closed if
// the secret env var is missing, so a misconfigured deployment can't
// silently expose paid endpoints.

export const UI_SESSION_COOKIE_NAME = "dugout-ui-session";

// Constant payload - the cookie value is just an HMAC of this string with
// the server secret. Anyone who has loaded a page gets the same value;
// anyone who hasn't doesn't. Replay between browsers is fine for this
// threat model.
const PAYLOAD = "dugout-ui:v1";

function getSecret(): string | null {
  const s = process.env.DUGOUT_UI_SECRET;
  return s && s.length >= 16 ? s : null;
}

async function sign(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(PAYLOAD),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Returns the cookie value to set, or null if the server isn't configured.
// Proxy is the only caller - it seeds the cookie on the first page request.
export async function mintUiSessionToken(): Promise<string | null> {
  const secret = getSecret();
  if (!secret) return null;
  return sign(secret);
}

export interface UiSessionFailure {
  status: 401 | 500;
  message: string;
}

// Verify a token value (typically read from the request cookie). Returns null
// on success, or a {status, message} describing the failure for the caller
// to turn into a Response.
export async function verifyUiSessionToken(
  token: string | undefined,
): Promise<UiSessionFailure | null> {
  const secret = getSecret();
  if (!secret) {
    return {
      status: 500,
      message:
        "Server not configured: set DUGOUT_UI_SECRET (>=16 chars) in your environment.",
    };
  }
  if (!token) {
    return { status: 401, message: "Unauthorized" };
  }
  const expected = await sign(secret);
  if (!timingSafeEqual(token, expected)) {
    return { status: 401, message: "Unauthorized" };
  }
  return null;
}
