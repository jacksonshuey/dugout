"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Top bar. On the landing page (`/`) the right side is empty so the
// marketing experience stays uncluttered (just the logo on the left). On
// every other route we render a discrete row of links to the operator
// surfaces (Console, Manager, Ask, Market Intel, Settings) so the demo
// audience can click between surfaces without typing URLs. The current
// route is highlighted in the brand color.

const APP_LINKS: { href: string; label: string }[] = [
  { href: "/console", label: "Console" },
  { href: "/manager", label: "Manager" },
  { href: "/ask", label: "Ask" },
  { href: "/market-intel", label: "Market Intel" },
];

export function Nav() {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  return (
    <header className="border-b border-border bg-background sticky top-0 z-30">
      <div className="px-6 h-12 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          {/* Logo mark - the canonical Dugout brand SVG. Includes the
              brown rounded-square background and the two stacked parallelogram
              cards as a single asset. Lives at public/dugout-logo.svg so it
              can also be used for OG image, favicon, marketing materials. */}
          <Image
            src="/dugout-logo.svg"
            alt=""
            aria-hidden
            width={20}
            height={20}
            className="w-5 h-5"
            title="Dugout - the intelligence layer for sales teams"
          />
          <span className="font-semibold tracking-tight text-sm">Dugout</span>
        </Link>
        {isLanding ? null : (
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
