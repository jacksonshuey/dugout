<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:agentmail -->
# AgentMail

The inbound newsletter pipeline (`src/app/api/inbound-email/agentmail/route.ts`) and any future outbound email work both go through AgentMail — an Email API for Agents.

Before writing or modifying AgentMail code, read the docs:

- llms.txt (overview + all doc links): https://docs.agentmail.to/llms.txt
- llms-full.txt (complete reference with inline code examples): https://docs.agentmail.to/llms-full.txt

Start with `llms.txt`, then pull `llms-full.txt` for specifics. Don't guess endpoint shapes, webhook payload schemas, or signature-verification semantics from memory — the docs are the source of truth.
<!-- END:agentmail -->
