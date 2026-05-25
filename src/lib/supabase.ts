import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only Supabase client.
//
// Uses the `service_role` key, which bypasses Row Level Security - appropriate
// for a single-tenant trusted server-side context (our cron + API routes).
// NEVER import this from a client component. Production multi-tenant would
// use the anon key + RLS policies per workspace.
//
// In production this key gets rotated periodically (Supabase dashboard
// → Settings → API → "Reset service_role JWT secret").

let _client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Run `npx vercel env pull .env.local` to sync.",
    );
  }

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
