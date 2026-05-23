"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Slim top bar. Primary navigation lives in the console sidebar (`/`).
// Only secondary destinations are pinned here.

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  const linkBase =
    "px-2.5 py-1 rounded-md transition-colors";
  const linkInactive = "text-muted hover:text-foreground hover:bg-black/[0.04]";
  const linkActive = "text-foreground bg-black/[0.06] font-medium";

  return (
    <header className="border-b border-border bg-background sticky top-0 z-30">
      <div className="px-4 h-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2" aria-current={isActive("/") ? "page" : undefined}>
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
            href="/market-intel"
            aria-current={isActive("/market-intel") ? "page" : undefined}
            className={cn(linkBase, isActive("/market-intel") ? linkActive : linkInactive)}
          >
            Market intel
          </Link>
          <Link
            href="/spec"
            aria-current={isActive("/spec") ? "page" : undefined}
            className={cn(linkBase, isActive("/spec") ? linkActive : linkInactive)}
          >
            Spec
          </Link>
          <Link
            href="/settings"
            aria-current={isActive("/settings") ? "page" : undefined}
            className={cn(linkBase, isActive("/settings") ? linkActive : linkInactive, "inline-flex items-center gap-1")}
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
