import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Single source of truth for the model used by Dugout. We pick Sonnet 4.6
// because (a) the digest is reasoning-heavy synthesis where Haiku is too thin,
// and (b) cost is negligible at this volume — 1-3k output tokens per digest
// × 9 AEs × 1 run/day ≈ $0.05/day at sticker price. Worth the quality bump.
const MODEL = "claude-sonnet-4-6";

// Fallback env loader. Next.js gives process.env precedence over .env.local —
// so if the shell exports an empty ANTHROPIC_API_KEY (as some agentic dev
// harnesses do), .env.local never wins. This reads .env.local directly when
// the env var is missing or empty. No-op in production where Vercel injects
// env vars directly.
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

function getClient(): Anthropic {
  const key = getKeyFromEnvOrFile();
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local for local dev or to Vercel env vars for production.",
    );
  }
  // Bump default retries (2 → 4). When Anthropic returns 529 overloaded, the
  // SDK retries with exponential backoff. Most capacity blips clear within a
  // few attempts; this prevents a one-off overload from breaking the demo.
  return new Anthropic({ apiKey: key, maxRetries: 4 });
}

export interface ChatOptions {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export async function chat({
  system,
  prompt,
  maxTokens = 2000,
  temperature = 0.4,
}: ChatOptions): Promise<string> {
  const client = getClient();
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

    return text;
  } catch (e) {
    // Classify by HTTP status on APIError. The Node SDK only exports the
    // base APIError class (no per-status subclasses), so we switch on status
    // directly. Demo-friendly messages flow up to the UI.
    if (e instanceof Anthropic.APIError) {
      if (e.status === 529)
        throw new Error(
          "Claude API is temporarily overloaded (their side). Retry in ~30s — the SDK already retried 4× with exponential backoff.",
        );
      if (e.status === 429)
        throw new Error(
          "Rate limited. Wait a minute then retry — your account may be hitting per-minute caps.",
        );
      if (e.status === 401)
        throw new Error(
          "Invalid API key. Check ANTHROPIC_API_KEY in .env.local or Vercel env vars.",
        );
    }
    throw e;
  }
}
