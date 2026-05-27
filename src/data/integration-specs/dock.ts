import type { IntegrationSpec } from "./types";

export const DOCK_SPEC: IntegrationSpec = {
  source: "Dock",
  tagline: "Deal rooms with engagement webhooks.",
  direction: "read",
  auth: {
    method: "api_key",
    docsUrl: "https://developers.dock.us/api-reference/tokens",
    notes:
      "Settings > API > Create new secret key. Admin only; shown once. Sent as `Authorization: Bearer ...`.",
  },
  baseUrl: "https://api.dock.us",
  setupFields: [
    {
      key: "api_key",
      label: "Dock secret key",
      type: "password",
      required: true,
      secret: true,
      description: "Admin only. Shown once at creation.",
      placeholder: "sk_xxxxxxxxxxxx",
    },
    {
      key: "workspace_id",
      label: "Workspace ID (optional)",
      type: "text",
      required: false,
      description:
        "Scope to a single Dock workspace. Leave blank for account-wide reads.",
      placeholder: "ws_abc123",
    },
    {
      key: "webhook_secret",
      label: "Webhook signing secret",
      type: "password",
      required: false,
      secret: true,
      description:
        "Auto-filled after Dugout registers webhooks via POST /v1/webhooks. Used to verify X-Dock-Signature.",
    },
  ],
  requiredScopes: [],
  webhooks: [
    { event: "workspace.viewed", description: "Workspace opened by a visitor" },
    { event: "workspace.page.viewed", description: "Specific page viewed" },
    { event: "workspace.link.clicked", description: "Outbound link clicked" },
    { event: "workspace.file.viewed", description: "File preview opened" },
    { event: "workspace.file.downloaded", description: "File downloaded" },
    { event: "workspace.form.submitted", description: "Embedded form submitted" },
    { event: "workspace.order_form.signed", description: "Order form signed by counter-party" },
    { event: "workspace.order_form.fully_signed", description: "Order form fully executed (all signers)" },
    { event: "workspace.nda.signed", description: "NDA signed" },
    { event: "workspace.plan.task.completed", description: "Mutual action plan task marked complete" },
    { event: "workspace.comment.created", description: "Comment added by visitor or seller" },
    { event: "workspace.message.created", description: "Direct message posted" },
  ],
  webhookSigning:
    "X-Dock-Signature header. HMAC-SHA256 over `${METHOD}\\n${URL}\\n${raw_body}` (newline-separated). URL includes query string.",
  rateLimit:
    "120 req/min general; 30 req/min on POST /v1/workspaces",
  syncModel: "webhooks",
  dataFreshness: "Sub-second on webhook events",
  headlessSetup: false,
  keyGotchas: [
    "Webhook signature payload includes the FULL URL (including query string), not just the path. If behind a proxy that rewrites paths, regenerate the canonical string from the proxy's view.",
    "Secret key is shown once. If the user closes the create-key modal early, they must rotate.",
    "POST /v1/workspaces is throttled to 30/min separately. Queue bulk creation or you'll 429 within seconds.",
  ],
};
