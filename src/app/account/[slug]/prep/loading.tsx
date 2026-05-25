// Suspense fallback for /account/[slug]/prep. The synthesizer awaits
// Supabase reads + SV Health computation; this skeleton lands instantly
// so the brand band doesn't flash blank.

export default function PrepLoading() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-6 animate-pulse">
      <div className="text-xs text-muted">Loading meeting brief…</div>
      <div className="rounded-2xl bg-brand/40 h-32" />
      <div className="rounded-xl border border-border bg-background h-28" />
      <div className="rounded-xl border border-border bg-background h-24" />
      <div className="rounded-xl border border-border bg-background h-32" />
      <div className="rounded-xl border border-border bg-background h-20" />
    </div>
  );
}
