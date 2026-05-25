// One-shot AgentMail inbox provisioner. Run locally after setting
// AGENTMAIL_API_KEY in .env.local — creates an inbox via the AgentMail
// REST API and prints the address + the webhook URL you need to register
// in the AgentMail console.
//
// Usage:
//   npx tsx scripts/provision-agentmail-inbox.ts
//   npx tsx scripts/provision-agentmail-inbox.ts --local dugout-prod
//   npx tsx scripts/provision-agentmail-inbox.ts --local dugout --deployment https://your-app.vercel.app
//
// Args:
//   --local <local-part>      Local part of the address (default "dugout").
//   --deployment <base-url>   Base URL of your deployment used to print the
//                             webhook URL the operator must register. If
//                             omitted, prints a placeholder string.
//   --name <display-name>     Optional display name (default "Dugout Newsletters").
//
// What this does NOT do (yet):
//   - Register the webhook endpoint with AgentMail. AgentMail's webhook
//     UI is the source of truth for the whsec_... secret — you have to
//     click through it once. This script prints what to paste where.
//   - Add publishers to INBOUND_SENDER_ALLOWLIST. The script prints a
//     reminder; you edit the env yourself.

import { createInbox } from "../src/lib/agentmail-client";

interface CliArgs {
  localPart: string;
  deployment: string | null;
  displayName: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    localPart: "dugout",
    deployment: null,
    displayName: "Dugout Newsletters",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--local" || arg === "--local-part") {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} requires a value`);
      args.localPart = next;
    } else if (arg === "--deployment" || arg === "--url") {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} requires a value`);
      args.deployment = next.replace(/\/+$/, "");
    } else if (arg === "--name" || arg === "--display-name") {
      const next = argv[++i];
      if (!next) throw new Error(`${arg} requires a value`);
      args.displayName = next;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${arg}`);
    }
  }
  return args;
}

const USAGE = `
Usage: npx tsx scripts/provision-agentmail-inbox.ts [options]

Options:
  --local <local-part>         Inbox local part (default: dugout)
  --deployment <url>           Base URL of your deployment (e.g. https://dugout.vercel.app)
  --name <display-name>        Display name (default: Dugout Newsletters)
  -h, --help                   Show this help

Env required:
  AGENTMAIL_API_KEY            Server-side AgentMail key (am_us_...)
`.trim();

async function main(): Promise<void> {
  if (!process.env.AGENTMAIL_API_KEY) {
    console.error(
      "AGENTMAIL_API_KEY not set. Add it to .env.local (or export it) before running.\n",
    );
    console.error(USAGE);
    process.exit(1);
  }

  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`arg parse: ${e instanceof Error ? e.message : String(e)}`);
    console.error(USAGE);
    process.exit(1);
    return;
  }

  console.log(
    `Creating AgentMail inbox: localPart="${args.localPart}", displayName="${args.displayName}"...`,
  );

  let inbox;
  try {
    inbox = await createInbox({
      displayName: args.displayName,
      localPart: args.localPart,
      // Idempotency key: re-running the script with the same local part
      // should not double-provision if the API supports client_id dedup.
      clientId: `dugout-provision-${args.localPart}`,
    });
  } catch (e) {
    console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
    console.error(
      "\nIf you see HTTP 404, the /v0 path prefix in src/lib/agentmail-client.ts may be wrong —\n" +
        "check the AgentMail API reference and update the INBOXES_PATH constant.",
    );
    process.exit(1);
    return;
  }

  const webhookUrl = args.deployment
    ? `${args.deployment}/api/inbound-email/agentmail`
    : "https://<your-deployment>/api/inbound-email/agentmail";

  console.log("\n=== Inbox created ===");
  console.log(`  Inbox ID: ${inbox.inboxId}`);
  console.log(`  Address:  ${inbox.address}`);
  console.log("");
  console.log("=== Next steps ===");
  console.log(
    "  1. AgentMail console → Webhooks → Create Webhook:",
  );
  console.log(`     URL:    ${webhookUrl}`);
  console.log(
    "     Events: message.received  (also subscribe message.received.spam /",
  );
  console.log(
    "             .blocked / .unauthenticated — the route handles them all)",
  );
  console.log("");
  console.log(
    "  2. Copy the resulting whsec_... signing secret into your env as",
  );
  console.log("     AGENTMAIL_WEBHOOK_SECRET (Vercel + .env.local).");
  console.log("");
  console.log(
    "  3. Subscribe each newsletter publisher from this address, then add",
  );
  console.log(
    "     their sending domains to INBOUND_SENDER_ALLOWLIST (comma-separated).",
  );
  console.log("     Example sender domains for the v1 catalog:");
  console.log(
    "       substack.com,beehiiv.com,tldrnewsletter.com,lennysnewsletter.com",
  );
  console.log("");
  console.log(
    "  4. (Optional) Use subscribeNewsletter(inboxId, fromAddress) from",
  );
  console.log(
    "     src/lib/agentmail-client.ts if your AgentMail plan requires",
  );
  console.log("     per-sender allowlisting on the AgentMail side.");
  console.log("");
}

main().catch((e) => {
  console.error(`\nUNEXPECTED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
