import { describe, expect, it } from "vitest";
import { renderMarkdownSafe } from "./markdown-sanitize";

describe("renderMarkdownSafe", () => {
  it("strips raw <script> tags", () => {
    const html = renderMarkdownSafe("Hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdownSafe('<img src="x" onerror="alert(1)">');
    expect(html).not.toMatch(/onerror/i);
    expect(html).not.toContain("alert(1)");
  });

  it("strips javascript: URLs in markdown links", () => {
    const html = renderMarkdownSafe("[click me](javascript:alert(1))");
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toContain("alert(1)");
  });

  it("strips <iframe> tags", () => {
    const html = renderMarkdownSafe('<iframe src="https://evil.com"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("strips svg with embedded script", () => {
    const html = renderMarkdownSafe(
      '<svg><script>alert(1)</script></svg>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  it("renders standard markdown formatting", () => {
    const html = renderMarkdownSafe(
      "# Heading\n\n**bold** and *italic* and a [link](https://example.com)",
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('href="https://example.com"');
  });

  it("preserves safe inline HTML", () => {
    const html = renderMarkdownSafe("Some <strong>bold</strong> text");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders empty input safely", () => {
    expect(renderMarkdownSafe("")).toBe("");
  });
});
