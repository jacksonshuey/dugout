"use client";

import { useEffect, useRef, useState } from "react";

// Sticky timeline rail for the 90-day plan section. Lives in the left
// column of the grid; the right column holds the phase cards.
//
// Behavior:
// - CSS-sticky inside the grid column so it pins as the user scrolls
//   through the three phases.
// - IntersectionObserver watches each <article id="phase-N"> in the
//   sibling column. Whichever phase has the highest viewport coverage
//   is the "active" one. The rail highlights it and ticks the Day-N
//   counter to the start of that phase.
// - Clicking a rail entry scrolls smoothly to that phase via the
//   browser-native hash + scroll-margin-top on the article (set in the
//   server component via `scroll-mt-24`).
// - Hides on mobile (md and up only) — at < md the rail is below the
//   eyebrow and would fight the phase content for vertical space.

interface RailPhase {
  id: string; // "phase-1"
  number: "01" | "02" | "03";
  range: string; // "Days 0 – 30"
  title: string;
}

interface Props {
  phases: RailPhase[];
}

// Day-number that anchors each phase's progress label on the rail.
// Index matches the phases array order.
const PHASE_START_DAYS = [1, 31, 61];

export function NinetyDayRail({ phases }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const ratiosRef = useRef<number[]>(phases.map(() => 0));

  useEffect(() => {
    if (typeof window === "undefined" || phases.length === 0) return;
    const nodes = phases
      .map((p) => document.getElementById(p.id))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    const ratios = phases.map(() => 0);
    ratiosRef.current = ratios;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const idx = phases.findIndex((p) => p.id === entry.target.id);
          if (idx === -1) continue;
          ratios[idx] = entry.intersectionRatio;
        }
        let bestIdx = 0;
        let bestRatio = -1;
        for (let i = 0; i < ratios.length; i++) {
          if (ratios[i] > bestRatio) {
            bestRatio = ratios[i];
            bestIdx = i;
          }
        }
        if (bestRatio > 0) {
          setActiveIdx(bestIdx);
        }
      },
      {
        // Multiple thresholds give us a smoother active-phase swap as
        // the user scrolls. The rootMargin trims the top so a phase
        // becomes active when it crosses the upper third of the
        // viewport rather than the absolute top — feels more natural.
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
        rootMargin: "-30% 0px -40% 0px",
      },
    );

    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [phases]);

  const activeDay = PHASE_START_DAYS[activeIdx] ?? 1;

  return (
    <nav
      aria-label="90-day plan timeline"
      className="hidden md:block sticky top-24"
    >
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
        Day
      </div>
      <div
        aria-live="polite"
        className="mt-1 text-4xl font-semibold tracking-tight tabular-nums transition-colors"
      >
        {String(activeDay).padStart(2, "0")}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.2em] font-mono text-muted">
        of 90
      </div>

      <ol className="mt-8 relative">
        {/* Vertical line behind the rail markers */}
        <span
          aria-hidden
          className="absolute left-[5px] top-1 bottom-1 w-px bg-border"
        />
        {phases.map((p, i) => {
          const active = i === activeIdx;
          return (
            <li key={p.id} className="relative pl-6 pb-7 last:pb-0">
              <a
                href={`#${p.id}`}
                className="group block"
                aria-current={active ? "true" : undefined}
              >
                <span
                  aria-hidden
                  className={`absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ring-background transition-colors ${
                    active ? "bg-brand" : "bg-border group-hover:bg-foreground/40"
                  }`}
                />
                <div
                  className={`text-[10px] uppercase tracking-[0.2em] font-mono transition-colors ${
                    active ? "text-brand" : "text-muted"
                  }`}
                >
                  Phase {p.number}
                </div>
                <div
                  className={`mt-1 text-sm font-semibold tracking-tight leading-snug transition-colors ${
                    active
                      ? "text-foreground"
                      : "text-foreground/55 group-hover:text-foreground/80"
                  }`}
                >
                  {p.title}
                </div>
                <div className="mt-1 text-[11px] font-mono text-muted">
                  {p.range}
                </div>
              </a>
            </li>
          );
        })}

        {/* Final marker: Day 90 end state */}
        <li className="relative pl-6">
          <a href="#day-90" className="group block">
            <span
              aria-hidden
              className="absolute left-0 top-1 w-[11px] h-[11px] rounded-full ring-4 ring-background bg-foreground group-hover:bg-brand transition-colors"
            />
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-muted group-hover:text-brand transition-colors">
              Day 90
            </div>
            <div className="mt-1 text-sm font-semibold tracking-tight text-foreground/55 group-hover:text-foreground transition-colors">
              End state
            </div>
          </a>
        </li>
      </ol>
    </nav>
  );
}
