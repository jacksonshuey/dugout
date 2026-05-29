import Image from "next/image";
import Link from "next/link";

// Top bar. The site is a single landing page, so the nav is just the brand
// mark linking home — no operator-surface link strip.

export function Nav() {
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
      </div>
    </header>
  );
}
