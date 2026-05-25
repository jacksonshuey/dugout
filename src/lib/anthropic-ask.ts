import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Anthropic client wrapper for the /ask agent (D1).
//
// Sibling to `src/lib/openai.ts`. Why a separate file instead of extending
// `src/lib/claude.ts`?
//   - `claude.ts` exports a single `chat(...)` helper that returns a string.
//     The agent loop needs full tool-use round-trips (messages.create with
//     `tools` + iterative `tool_use` / `tool_result` blocks), which doesn't
//     fit the single-shot chat() shape.
//   - Keeping `/ask`'s Anthropic surface in its own module mirrors the
//     openai.ts pattern: the route imports `HAS_ANTHROPIC_KEY` and
//     `getAnthropicClient()` and nothing else. The digest/classifier keep
//     using `chat()` unmodified.
//
// Pre-credit posture matches openai.ts: if ANTHROPIC_API_KEY is missing,
// HAS_ANTHROPIC_KEY = false and the route falls back to stub. The moment a
// key shows up in env vars (Vercel or .env.local), the same route flips to
// real tool-use without further code changes.

// Two models exposed to the /ask UI. Centralized here so a future model
// bump (Sonnet 5, Haiku 5) is a one-line change.
//
// - Sonnet for reasoning-heavy questions ("why is this deal stalling, walk
//   me through the evidence")
// - Haiku for cost-sensitive / quick-turn questions
export const ASK_ANTHROPIC_SONNET_MODEL = "claude-sonnet-4-6";
export const ASK_ANTHROPIC_HAIKU_MODEL = "claude-haiku-4-5";

// Same env-vs-file fallback as openai.ts. Some agentic harnesses export an
// empty ANTHROPIC_API_KEY which would otherwise win over .env.local; read
// the file directly when the env var is missing or blank. No-op in
// production where Vercel injects env vars directly.
function getKeyFromEnvOrFile(): string | null {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  try {
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const match = raw.match(/^ANTHROPIC_API_KEY=(.*)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Boolean snapshot at module-load time. The route reads this to decide
// stub-vs-real path, and the /api/ask/providers endpoint reads it to
// grey-out Anthropic models in the UI.
export const HAS_ANTHROPIC_KEY: boolean = Boolean(getKeyFromEnvOrFile());

// Returns an Anthropic client, or null if no key is configured. Callers
// MUST handle the null case - see `src/lib/ask-agent.ts` for the stub
// fallback.
export function getAnthropicClient(): Anthropic | null {
  const key = getKeyFromEnvOrFile();
  if (!key) return null;
  // Bump retries (default 2 → 4) for the same reason claude.ts does: 529
  // overloaded clears within a few attempts and the demo shouldn't break
  // on a one-off blip.
  return new Anthropic({ apiKey: key, maxRetries: 4 });
}
