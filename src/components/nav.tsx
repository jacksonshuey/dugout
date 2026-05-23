"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Slim top bar. Primary navigation lives in the console sidebar (`/`).
// Only secondary destinations are pinned here.

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-background sticky top-0 z-30">
      <div className="px-4 h-12 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {/* Logo mark — a baseball base seen in 3/4 forward perspective.
              Trapezoidal foreshortening (wider top edge than bottom) reads
              as a flat tile tilted toward the viewer. Thin inner outline
              gives subtle dimension without selling it as 3D. */}
          <span
            aria-hidden
            className="w-5 h-5 rounded-[5px] bg-brand flex items-center justify-center"
            title="Dugout — the dugout view of your pipeline"
          >
            <svg
              viewBox="0 0 24 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
              className="w-3.5 h-3.5 text-white"
            >
              <polygon points="6,3 21,3 18,14 3,14" />
              <polygon points="8,5 19,5 16.5,12.5 5.5,12.5" strokeOpacity="0.4" />
            </svg>
          </span>
          <span className="font-semibold tracking-tight text-sm">Dugout</span>
        </Link>
        <nav className="flex items-center gap-1 text-xs">
          <Link
            href={pathname === "/" ? "#demo" : "/#demo"}
            scroll={true}
            className={cn(
              "inline-flex items-center px-3 h-7 rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors",
            )}
          >
            Jump to demo ↓
          </Link>
        </nav>
      </div>
    </header>
  );
}
