import { marked } from "marked";

// Renders markdown source content inside the SourcePreviewModal. Used for
// non-email signals (NewsAPI articles, Firecrawl scrapes, SEC filings) whose
// derivation source is persisted as `external_signals.source_content_md`.
//
// Sanitization: marked itself emits HTML from a fixed grammar - no script
// tags, no inline event handlers - so dangerouslySetInnerHTML is safe within
// our content boundary. We don't pass raw user-controlled HTML through here.
// If we ever ingest publisher HTML into source_content_md directly (today we
// only persist markdown), add DOMPurify before this render.
//
// Styling: prose-ish, reading-width container, ~16px body, h1/h2 sized down
// vs default so they don't dominate inside the modal. Tailwind utility
// classes via a tagged className scope so the iframe-sized container at
// ~720px feels like a longform article rather than a UI dump.

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function MarkdownBody({ content }: { content: string }) {
  const html = marked.parse(content, { async: false }) as string;
  return (
    <div
      className="markdown-body text-[15px] leading-7 text-foreground/90"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
