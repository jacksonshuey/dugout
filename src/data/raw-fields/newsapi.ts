import type { RawObject } from "./types";

// NewsAPI surface: /everything and /top-headlines endpoints. Article shape
// is uniform across both endpoints.

export const NEWSAPI_OBJECTS: readonly RawObject[] = [
  {
    source: "NewsAPI",
    object: "Article",
    fields: [
      { key: "source_id", type: "string", description: "News source identifier (e.g., bbc-news)" },
      { key: "source_name", type: "string", description: "Display name of the source" },
      { key: "author", type: "string", description: "Article byline" },
      { key: "title", type: "string", description: "Article headline" },
      { key: "description", type: "text", description: "Article snippet or summary" },
      { key: "url", type: "string", description: "Direct URL to the article" },
      { key: "url_to_image", type: "string", description: "URL of the article's lead image" },
      { key: "published_at", type: "date", description: "Publication timestamp (ISO 8601 UTC)" },
      { key: "content", type: "text", description: "Article body, truncated to ~200 chars" },
    ],
  },
  {
    source: "NewsAPI",
    object: "EverythingRequest",
    fields: [
      { key: "q", type: "string", description: "Keywords with advanced operators (+, -, AND, OR, NOT)" },
      { key: "q_in_title", type: "string", description: "Keywords restricted to article title" },
      { key: "search_in", type: "enum", description: "Where to search", enumValues: ["title", "description", "content"] },
      { key: "sources", type: "string", description: "Comma-separated source identifiers (max 20)" },
      { key: "domains", type: "string", description: "Comma-separated domains to include" },
      { key: "exclude_domains", type: "string", description: "Comma-separated domains to exclude" },
      { key: "from", type: "date", description: "Oldest article date" },
      { key: "to", type: "date", description: "Newest article date" },
      { key: "language", type: "enum", unit: "ISO 639-1", description: "Language filter", enumValues: ["ar", "de", "en", "es", "fr", "he", "it", "nl", "no", "pt", "ru", "sv", "ud", "zh"] },
      { key: "sort_by", type: "enum", description: "Result ordering", enumValues: ["relevancy", "popularity", "publishedAt"] },
      { key: "page_size", type: "int", unit: "count", description: "Results per page (max 100)" },
      { key: "page", type: "int", description: "Page number for pagination" },
    ],
  },
  {
    source: "NewsAPI",
    object: "TopHeadlinesRequest",
    fields: [
      { key: "country", type: "string", unit: "ISO 3166-1", description: "Two-letter country code" },
      { key: "category", type: "enum", description: "Topical category", enumValues: ["business", "entertainment", "general", "health", "science", "sports", "technology"] },
      { key: "sources", type: "string", description: "Comma-separated source identifiers" },
      { key: "q", type: "string", description: "Keywords or phrases" },
      { key: "page_size", type: "int", unit: "count", description: "Results per page" },
      { key: "page", type: "int", description: "Page number" },
    ],
  },
];
