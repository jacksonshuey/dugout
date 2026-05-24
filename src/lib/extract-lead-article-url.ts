// Lead-article URL extraction.
//
// Pure helper. Given the HTML (or text) body of a newsletter, returns the
// first URL that is plausibly the lead article — that is, NOT a tracking
// pixel, NOT an unsubscribe link, NOT a "view in browser" / forward CTA,
// NOT an image asset.
//
// Heuristic, ~95% correct. The raw-email drawer is the fallback when this
// returns null — see design §9.
//
// Known limitations:
//   - Wrapped tracking URLs are lost. Mailchimp/Beehiiv wrap real article
//     URLs in tracker redirects. We do NOT follow redirects (would require
//     an HTTP call per email — too slow at scale).
//   - First-URL bias. A newsletter that puts "Forward to a friend" above
//     the lead article would surface the forward link first. Mitigated by
//     the unsubscribe/preferences/forward regex.
//   - Sponsored-content false positive. Industry Dive's lead anchor is
//     usually the lead article, but their daily roundup sometimes leads
//     with a sponsor block. ~5% miss rate; the drawer covers recovery.

// Tracking hosts we know wrap real URLs in opaque redirects. Add to this
// list when a new publisher's tracking domain shows up in extraction logs
// (the pipeline logs `extract_lead_url_returned=null from=<sender_domain>`
// as a breadcrumb — see design §12 Q4).
const TRACKING_HOSTS = [
  "list-manage.com", // Mailchimp
  "track.beehiiv.com",
  "click.convertkit-mail4.com", // ConvertKit
  "open.convertkit-mail4.com",
  "links.substack.com",
  "go.pardot.com",
  "click.linksynergy.com",
  "trk.klclick.com", // Klaviyo
  "email.fortune.com", // generic newsletter tracker pattern
  "links.cmail19.com", // Campaign Monitor
  "createsend4.com",
];

const UNSUB_PATH_RE =
  /(unsubscribe|preferences|email[-_ ]?settings|manage[-_ ]?subscription|view[-_ ]?in[-_ ]?browser|forward[-_ ]?to[-_ ]?friend)/i;
const ASSET_EXT_RE = /\.(jpg|jpeg|png|gif|svg|webp|css|js|ico)(\?|$)/i;

function stripTags(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAnchors(
  source: string,
): Array<{ href: string; text: string }> {
  const out: Array<{ href: string; text: string }> = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push({ href: m[1], text: stripTags(m[2]) });
  }
  return out;
}

function extractBareUrls(source: string): string[] {
  const out: string[] = [];
  const re = /\bhttps?:\/\/[^\s<>"')]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    out.push(m[0]);
  }
  return out;
}

export function extractLeadArticleUrl(htmlOrText: string): string | null {
  if (!htmlOrText) return null;

  // 1. Prefer HTML anchors over bare-text URLs — the anchor text often
  //    hints at editorial vs. nav (longer anchor text → more likely the
  //    lead article).
  const anchors = extractAnchors(htmlOrText);
  const candidates =
    anchors.length > 0
      ? anchors
      : extractBareUrls(htmlOrText).map((u) => ({ href: u, text: "" }));

  for (const c of candidates) {
    if (!/^https?:\/\//i.test(c.href)) continue;
    let host = "";
    try {
      host = new URL(c.href).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!host) continue;

    // Skip tracking hosts (almost always wrappers around real URLs we
    // can't easily resolve without making an HTTP call — accept the loss).
    if (TRACKING_HOSTS.some((t) => host === t || host.endsWith("." + t))) {
      continue;
    }

    // Skip unsubscribe / preferences / view-in-browser navigation.
    if (UNSUB_PATH_RE.test(c.href)) continue;

    // Skip asset URLs.
    if (ASSET_EXT_RE.test(c.href)) continue;

    // Skip mailto: and bare anchors (already filtered by protocol check above
    // but defensive).
    if (/^(mailto:|#)/i.test(c.href)) continue;

    // First candidate that survives all filters wins.
    return c.href;
  }

  return null;
}
