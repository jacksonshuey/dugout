import { supabaseAdmin } from "./supabase";

// Raw web-scrape store. The Firecrawl adapter (src/lib/firecrawl-adapter.ts)
// pulls a fixed set of content pages per tracked account, dumps the
// returned markdown here, and lets the classify-pending sweeper turn each
// row into one or more external_signals.
//
// Schema mirrors inbound_emails so the sweeper can treat both as
// "unclassified content queues."
//
// Dedup at the row level is enforced by the (account_id, url, scraped_date)
// unique constraint on the table - re-scraping the same page on the same
// day is a silent no-op.

export interface WebScrape {
  id: string;
  account_id: string;
  url: string;
  scraped_at: string;
  scraped_date: string;
  status_code: number | null;
  markdown: string | null;
  raw_size_bytes: number;
  classified_at: string | null;
  signals_emitted: number;
  error: string | null;
  created_at: string;
}

export interface NewWebScrape {
  account_id: string;
  url: string;
  status_code?: number | null;
  markdown?: string | null;
  raw_size_bytes?: number;
  error?: string | null;
}

// Insert one scrape row. Returns the persisted row, or null if a row with
// the same (account_id, url, scraped_date) already exists (dedup hit on
// re-scrape of the same page on the same day). Throws on any other Supabase
// error so the cron can mark the account as partially-failed.
export async function insertWebScrape(
  scrape: NewWebScrape,
): Promise<WebScrape | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("web_scrapes")
    .insert({
      account_id: scrape.account_id,
      url: scrape.url,
      status_code: scrape.status_code ?? null,
      markdown: scrape.markdown ?? null,
      raw_size_bytes: scrape.raw_size_bytes ?? (scrape.markdown?.length ?? 0),
      error: scrape.error ?? null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return null;
    throw new Error(`web_scrapes insert failed: ${error.message}`);
  }
  return data as WebScrape;
}

export async function markWebScrapeClassified(
  id: string,
  signalCount: number,
): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb
    .from("web_scrapes")
    .update({
      classified_at: new Date().toISOString(),
      signals_emitted: signalCount,
    })
    .eq("id", id);
  if (error) throw new Error(`web_scrapes update failed: ${error.message}`);
}

// Sweeper queue. Only rows with markdown content + no classification yet.
// Oldest first so backlogs drain in arrival order. Limit keeps each sweeper
// invocation under the Vercel function cap.
export async function getUnclassifiedWebScrapes(
  limit = 10,
): Promise<WebScrape[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("web_scrapes")
    .select("*")
    .is("classified_at", null)
    .not("markdown", "is", null)
    .order("scraped_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`web_scrapes read failed: ${error.message}`);
  return (data ?? []) as WebScrape[];
}

export interface WebScrapeStats {
  scraped24h: number;
  scrapedTotal: number;
  lastScrapedAt: string | null;
}

export async function getWebScrapeStats(): Promise<WebScrapeStats> {
  const sb = supabaseAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [recent, total, last] = await Promise.all([
    sb
      .from("web_scrapes")
      .select("id", { count: "exact", head: true })
      .gte("scraped_at", since),
    sb.from("web_scrapes").select("id", { count: "exact", head: true }),
    sb
      .from("web_scrapes")
      .select("scraped_at")
      .order("scraped_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (recent.error) throw new Error(`web_scrapes count failed: ${recent.error.message}`);
  if (total.error) throw new Error(`web_scrapes count failed: ${total.error.message}`);
  if (last.error) throw new Error(`web_scrapes read failed: ${last.error.message}`);

  return {
    scraped24h: recent.count ?? 0,
    scrapedTotal: total.count ?? 0,
    lastScrapedAt: (last.data?.scraped_at as string | undefined) ?? null,
  };
}
