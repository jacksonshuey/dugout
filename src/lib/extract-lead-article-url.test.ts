// Tests for extract-lead-article-url. Each test feeds a representative
// fixture from a publisher and asserts the first non-tracking, non-unsub,
// non-asset URL wins.
//
// Design doc: /docs/filter-design.md §9 + §10 (tests 19-21).

import { describe, expect, test } from "vitest";
import { extractLeadArticleUrl } from "./extract-lead-article-url";

describe("extractLeadArticleUrl · publisher fixtures", () => {
  test("substack_fixture: skips tracking + view-in-browser + unsubscribe", () => {
    const html = `
      <html><body>
        <p>
          <a href="https://links.substack.com/click/abc?u=123">View in browser</a>
        </p>
        <h1>
          <a href="https://example.substack.com/p/the-real-lead-article">The Real Lead Article</a>
        </h1>
        <p>
          <a href="https://substack.com/unsubscribe?token=xyz">Unsubscribe</a>
        </p>
      </body></html>
    `;
    const got = extractLeadArticleUrl(html);
    expect(got).toBe("https://example.substack.com/p/the-real-lead-article");
  });

  test("beehiiv_fixture: skips track.beehiiv.com tracker, returns first editorial URL", () => {
    const html = `
      <a href="https://track.beehiiv.com/click/redirect?u=hidden">Click</a>
      <a href="https://www.brainyacts.com/p/edition-129-attorney-ai">Edition 129</a>
      <a href="https://brainyacts.com/preferences">Update preferences</a>
    `;
    const got = extractLeadArticleUrl(html);
    expect(got).toBe("https://www.brainyacts.com/p/edition-129-attorney-ai");
  });

  test("industry_dive_fixture: skips asset URL + sponsor unsub, returns lead article", () => {
    const html = `
      <img src="https://www.cfodive.com/header-logo.png" />
      <a href="https://www.cfodive.com/logo.svg">logo</a>
      <a href="https://www.cfodive.com/news/cfo-reorg-fortune-500-q2/12345/">Top story: CFO reorg at Fortune 500</a>
      <a href="https://www.cfodive.com/unsubscribe?token=abc">Manage subscription</a>
    `;
    const got = extractLeadArticleUrl(html);
    expect(got).toBe(
      "https://www.cfodive.com/news/cfo-reorg-fortune-500-q2/12345/",
    );
  });

  test("returns null when no candidate survives", () => {
    const html = `
      <a href="https://track.beehiiv.com/click/x">Click</a>
      <a href="https://example.com/unsubscribe">Unsubscribe</a>
      <a href="mailto:editor@example.com">Reply</a>
    `;
    const got = extractLeadArticleUrl(html);
    expect(got).toBeNull();
  });
});
