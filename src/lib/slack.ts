// Slack webhook poster. We support two modes:
//   1. Live mode  — posts to the SLACK_WEBHOOK_URL configured in env
//   2. Demo mode  — returns a preview payload without posting, so the UI can
//                    show "this is what would be sent" if no webhook is set.

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{ type: string; text?: string; url?: string }>;
}

export interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
}

export async function postToSlack(payload: SlackPayload): Promise<{
  mode: "live" | "preview";
  ok: boolean;
  payload: SlackPayload;
  error?: string;
}> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) {
    return { mode: "preview", ok: true, payload };
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        mode: "live",
        ok: false,
        payload,
        error: `Slack returned ${res.status}: ${text}`,
      };
    }
    return { mode: "live", ok: true, payload };
  } catch (e) {
    return {
      mode: "live",
      ok: false,
      payload,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// Format a list of signals into a Slack Block Kit payload. Designed to match
// what the production system would actually send — readable, with one-click
// links and a clear severity prefix.
export function signalsToSlackPayload(
  repName: string,
  digestMarkdown: string,
): SlackPayload {
  return {
    text: `Dugout morning digest for ${repName}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Dugout — ${repName}'s morning digest*`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: digestMarkdown,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Tune what you receive in Dugout > Settings",
          },
        ],
      },
    ],
  };
}
