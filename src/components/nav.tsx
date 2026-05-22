import Link from "next/link";

// Slim top bar. Primary navigation lives in the console sidebar (`/`).
// Only secondary destinations are pinned here.

export function Nav() {
  return (
    <header className="border-b border-border bg-background sticky top-0 z-30">
      <div className="px-4 h-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="w-5 h-5 rounded-[5px] bg-brand flex items-center justify-center text-white text-[9px] font-bold"
            title="Dugout — the dugout view of your pipeline"
          >
            ◆
          </span>
          <span className="font-semibold tracking-tight text-sm">Dugout</span>
        </Link>
        <nav className="flex items-center gap-1 text-xs">
          <Link
            href="/spec"
            className="px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-black/[0.04] transition-colors"
          >
            Spec
          </Link>
          <Link
            href="/settings"
            className="px-2.5 py-1 rounded-md text-muted hover:text-foreground hover:bg-black/[0.04] transition-colors inline-flex items-center gap-1"
            title="Settings"
          >
            <span aria-hidden>⚙</span>
            <span>Settings</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
