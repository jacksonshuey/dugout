// Suspense fallback for /account/[slug]. The page itself is a server
// component that awaits workspace config + 3 signal sources; this skeleton
// renders during that wait so the brand band lands immediately instead of
// flashing blank.

export default function AccountLoading() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-6 space-y-8 animate-pulse">
      <div className="text-xs text-muted">Loading account…</div>
      <div className="rounded-2xl bg-brand/40 h-28" />
      <div className="rounded-xl border border-border bg-background h-40" />
      <div className="rounded-xl border border-border bg-background h-32" />
      <div className="space-y-2">
        <div className="rounded-xl border border-border bg-background h-12" />
        <div className="rounded-xl border border-border bg-background h-12" />
        <div className="rounded-xl border border-border bg-background h-12" />
      </div>
    </div>
  );
}
