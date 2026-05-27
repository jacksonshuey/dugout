import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";

// `marked` does NOT sanitize. Source content for /market-intel signals
// comes from publisher email HTML (newsletter-adapter.ts) and Firecrawl
// scrapes (web-scrape-classifier.ts) — both attacker-influenced. Without
// DOMPurify, a payload like `<img src=x onerror=...>` in a newsletter
// from any *.substack.com / *.beehiiv.com sender executes in the
// authenticated trydugout.com origin when a signal is previewed.

marked.setOptions({ gfm: true, breaks: false });

export function renderMarkdownSafe(content: string): string {
  const dirty = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
}
