"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Top bar. On the landing page (`/`) the link strip is suppressed per the
// session 5 decision to keep the marketing experience uncluttered (only the
// logo + "Jump to demo" CTA remain). On every other route we render a
// discrete row of links to the operator surfaces - Console, Manager, Ask,
// Market Intel, Settings - so the demo audience can click between
// surfaces without typing URLs. The current route is highlighted in the
// brand color.

const APP_LINKS: { href: string; label: string }[] = [
  { href: "/console", label: "Console" },
  { href: "/manager", label: "Manager" },
  { href: "/ask", label: "Ask" },
  { href: "/market-intel", label: "Market Intel" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <header className="border-b border-border bg-background sticky top-0 z-30">
      <div className="px-4 h-12 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          {/* Logo mark - a baseball base seen in 3/4 forward perspective.
              Trapezoidal foreshortening (wider top edge than bottom) reads
              as a flat tile tilted toward the viewer. Thin inner outline
              gives subtle dimension without selling it as 3D. */}
          <span
            aria-hidden
            className="w-5 h-5 rounded-[5px] bg-brand flex items-center justify-center"
            title="Dugout - the intelligence layer for sales teams"
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
              <polygon points="7.8,4.65 18.3,4.65 16.2,12.35 5.7,12.35" strokeOpacity="0.4" />
            </svg>
          </span>
          <span className="font-semibold tracking-tight text-sm">Dugout</span>
        </Link>
        {isLanding ? (
          // Landing page: keep the single CTA, no link strip.
          <nav className="flex items-center gap-1 text-xs">
            <Link
              href="#demo"
              scroll={true}
              className="inline-flex items-center px-3 h-7 rounded-md bg-foreground text-background font-medium hover:bg-foreground/90 transition-colors"
            >
              Jump to demo ↓
            </Link>
          </nav>
        ) : (
          // Non-landing routes: render the operator-surface link strip. Active
          // route gets a brand-color underline + foreground text; siblings sit
          // in muted weight so the eye lands on "you are here" first.
          <nav className="flex items-center gap-0.5 sm:gap-1 text-xs overflow-x-auto">
            {APP_LINKS.map((link) => {
              const active =
                pathname === link.href ||
                pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "inline-flex items-center h-7 px-2.5 rounded-md whitespace-nowrap transition-colors",
                    active
                      ? "text-brand font-semibold border-b-2 border-brand rounded-b-none"
                      : "text-muted hover:text-foreground",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
