import Link from "next/link";
import { NinetyDayVision } from "@/components/landing/ninety-day-vision";

export const metadata = {
  title: "90-day plan · Dugout",
  description:
    "The 90-day buildout: every named integration ingested through zippering into one ontology.",
};

export default function PlanPage() {
  return (
    <div className="bg-background min-h-screen">
      <PlanNav />
      <NinetyDayVision />
      <PlanFooter />
    </div>
  );
}

function PlanNav() {
  return (
    <nav className="border-b border-border bg-background sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between gap-4">
        <Link
          href="/"
          className="text-sm font-medium text-foreground/70 hover:text-foreground transition-colors inline-flex items-center gap-1.5"
        >
          <span aria-hidden>←</span>
          <span>Back to Dugout</span>
        </Link>
        <Link
          href="/#demo"
          className="text-sm font-medium text-brand hover:underline inline-flex items-center gap-1.5"
        >
          <span>See the live demo</span>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </nav>
  );
}

function PlanFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10 flex items-baseline justify-between gap-4 flex-wrap">
        <Link
          href="/"
          className="text-sm font-medium text-foreground/70 hover:text-brand transition-colors"
        >
          ← Back to Dugout
        </Link>
        <span className="text-[11px] text-muted font-mono">
          Built by Jackson Shuey · designed for the GTM Engineer role at Checkbox
        </span>
      </div>
    </footer>
  );
}
