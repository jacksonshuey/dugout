// Granola public API client — typed wrapper around
// https://public-api.granola.ai. Spec source: /v1/notes/{id} OpenAPI doc
// shared in session 5.
//
// Rate limits (from Granola docs):
//   - 25 requests burst capacity
//   - 5 requests/second sustained (300/minute)
//   - 429 on overflow
//
// We model this as a simple in-flight throttler: at most 5 calls dispatched
// per rolling second. The list endpoint already paginates so back-pressure
// kicks in naturally. We DON'T retry 429 automatically — the adapter
// surfaces a partial failure instead, because chasing 429s under cron load
// could pile up unbounded.

const GRANOLA_BASE = "https://public-api.granola.ai";
const MAX_RPS = 5;
const REQUEST_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// Spec types — names mirror the OpenAPI schema. Optional fields use `null`
// to match the spec (which is explicit about nullable strings).
// ---------------------------------------------------------------------------

export interface GranolaUser {
  name: string | null;
  email: string;
}

export interface GranolaCalendarInvitee {
  email: string;
}

export interface GranolaCalendarEvent {
  event_title: string | null;
  invitees: GranolaCalendarInvitee[];
  organiser: string | null;
  calendar_event_id: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
}

export interface GranolaFolder {
  id: string;
  object: "folder";
  name: string;
  parent_folder_id: string | null;
}

export interface GranolaTranscriptTurn {
  speaker: {
    source: "microphone" | "speaker";
    diarization_label?: string;
  };
  text: string;
  start_time: string;
  end_time: string;
}

export interface GranolaNote {
  id: string;
  object: "note";
  title: string | null;
  owner: GranolaUser;
  created_at: string;
  updated_at: string;
  web_url: string;
  calendar_event: GranolaCalendarEvent | null;
  attendees: GranolaUser[];
  folder_membership: GranolaFolder[];
  summary_text: string;
  summary_markdown: string | null;
  // Only populated on Get Note with ?include=transcript. Null when omitted.
  transcript: GranolaTranscriptTurn[] | null;
}

export interface ListNotesResponse {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Rate-limit throttle. Keeps a sliding window of timestamps for the last
// MAX_RPS dispatches. If we'd exceed it, sleep until the oldest is > 1s ago.
// Single-process scope — fine for our cron + on-demand sync.
// ---------------------------------------------------------------------------

class RateLimiter {
  private timestamps: number[] = [];
  async wait(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);
    if (this.timestamps.length >= MAX_RPS) {
      const sleepMs = 1000 - (now - this.timestamps[0]) + 5;
      await new Promise((r) => setTimeout(r, sleepMs));
      return this.wait();
    }
    this.timestamps.push(now);
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GranolaApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, message: string, body: string) {
    super(message);
    this.status = status;
    this.body = body;
    this.name = "GranolaApiError";
  }
}

// ---------------------------------------------------------------------------
// Client. Created per-sync so the rate-limiter window doesn't leak across
// independent runs.
// ---------------------------------------------------------------------------

export interface ListNotesParams {
  // ISO timestamp; only notes created at or after this point.
  created_after?: string;
  // Server-supplied cursor for the next page.
  cursor?: string;
}

export interface GranolaClient {
  listNotes(params?: ListNotesParams): Promise<ListNotesResponse>;
  getNote(
    noteId: string,
    opts?: { includeTranscript?: boolean },
  ): Promise<GranolaNote>;
  // Convenience: walks pagination and returns every note matching the
  // filters. Stops at maxPages to bound cron runtime.
  listAllNotes(
    params?: ListNotesParams & { maxPages?: number },
  ): Promise<GranolaNote[]>;
}

export function createGranolaClient(apiKey: string): GranolaClient {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("Granola API key is empty");
  }
  const headers = {
    Authorization: `Bearer ${apiKey.trim()}`,
    "User-Agent": "Dugout/1.0 (+https://trydugout.com)",
    Accept: "application/json",
  } as const;
  const limiter = new RateLimiter();

  async function request<T>(path: string): Promise<T> {
    await limiter.wait();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(`${GRANOLA_BASE}${path}`, {
        headers,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new GranolaApiError(
          res.status,
          `Granola API ${res.status} on ${path}`,
          text.slice(0, 500),
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new GranolaApiError(
          res.status,
          `Granola API returned non-JSON on ${path}`,
          text.slice(0, 500),
        );
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    async listNotes(params): Promise<ListNotesResponse> {
      const q = new URLSearchParams();
      if (params?.created_after) q.set("created_after", params.created_after);
      if (params?.cursor) q.set("cursor", params.cursor);
      const query = q.toString();
      const path = `/v1/notes${query ? `?${query}` : ""}`;
      return request<ListNotesResponse>(path);
    },

    async getNote(noteId, opts): Promise<GranolaNote> {
      const q = new URLSearchParams();
      if (opts?.includeTranscript) q.set("include", "transcript");
      const query = q.toString();
      const path = `/v1/notes/${encodeURIComponent(noteId)}${query ? `?${query}` : ""}`;
      return request<GranolaNote>(path);
    },

    async listAllNotes(params): Promise<GranolaNote[]> {
      const maxPages = params?.maxPages ?? 10;
      const out: GranolaNote[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < maxPages; i++) {
        const page = await this.listNotes({
          created_after: params?.created_after,
          cursor,
        });
        out.push(...page.notes);
        if (!page.hasMore || !page.cursor) break;
        cursor = page.cursor;
      }
      return out;
    },
  };
}
