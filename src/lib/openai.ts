import OpenAI from "openai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Thin OpenAI client wrapper. Sibling to `src/lib/claude.ts`. The /ask route
// (U4) is intentionally on OpenAI while the morning digest stays on
// Anthropic — per synthesis.md "The AI query layer", running the two product
// surfaces on different providers means a 529 on one provider doesn't take
// the other offline.
//
// Pre-credit posture: if OPENAI_API_KEY is missing, this module reports
// HAS_OPENAI_KEY = false and getOpenAIClient() returns null. The /ask route
// then serves a deterministic stub. The moment a key shows up in env vars,
// the same route flips to real tool-use without further code changes.

// The model name is centralized here so future model bumps are a one-line
// change. GPT-4o-2024-08-06 is the structured-output / tool-use model we
// validated against. When GPT-5 GA's the swap happens here.
export const ASK_MODEL = "gpt-4o-2024-08-06";

// Fallback env loader — same pattern as `claude.ts`. Some agentic dev
// harnesses export an empty OPENAI_API_KEY which would otherwise win over
// `.env.local`. Read the file directly when the env var is missing or blank.
// No-op in production where Vercel injects env vars directly.
function getKeyFromEnvOrFile(): string | null {
  const fromEnv = process.env.OPENAI_API_KEY;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  try {
    const path = join(process.cwd(), ".env.local");
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const match = raw.match(/^OPENAI_API_KEY=(.*)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Boolean snapshot at module-load time. The route reads this to decide
// stub-vs-real path. Computed via the same loader as the client so the two
// agree (no "key resolves but HAS_OPENAI_KEY=false" drift).
export const HAS_OPENAI_KEY: boolean = Boolean(getKeyFromEnvOrFile());

// Returns an OpenAI client, or null if no key is configured. Callers must
// handle the null case — see `src/app/api/ask/route.ts` for the stub fallback.
export function getOpenAIClient(): OpenAI | null {
  const key = getKeyFromEnvOrFile();
  if (!key) return null;
  // Bumped retries like the Anthropic wrapper — OpenAI 429s clear within a
  // few exponential-backoff attempts; the demo shouldn't break on a blip.
  return new OpenAI({ apiKey: key, maxRetries: 4 });
}
