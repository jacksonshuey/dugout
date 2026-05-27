import { renderMarkdownSafe } from "@/lib/markdown-sanitize";

// Renders markdown source content inside the SourcePreviewModal. Used for
// non-email signals (NewsAPI articles, Firecrawl scrapes, SEC filings) whose
// derivation source is persisted as `external_signals.source_content_md`.
//
// Sanitization rationale lives in src/lib/markdown-sanitize.ts. Do not
// inline marked() here without DOMPurify — `source_content_md` can contain
// attacker-influenced HTML (newsletter publisher HTML, Firecrawl scrapes).

export function MarkdownBody({ content }: { content: string }) {
  const html = renderMarkdownSafe(content);
  return (
    <div
      className="markdown-body text-[15px] leading-7 text-foreground/90"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
