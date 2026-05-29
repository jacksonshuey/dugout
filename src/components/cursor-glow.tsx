"use client";

import { useEffect, useRef } from "react";

// Slow-drifting, heavily-blurred orange blobs that float behind the whole page
// for a faint ambient warmth. Pure CSS animation (see globals.css), no JS.
export function AmbientGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20 overflow-hidden"
    >
      <span className="ambient-blob ambient-blob-1" />
      <span className="ambient-blob ambient-blob-2" />
      <span className="ambient-blob ambient-blob-3" />
    </div>
  );
}

// A barely-there orange (brand) radial glow that tracks the cursor across the
// whole viewport. Fixed + pointer-events-none so it tints everything subtly
// without intercepting clicks. Position is driven by CSS custom properties
// updated on mousemove; a short background transition keeps the glow gliding
// rather than snapping. Disabled under prefers-reduced-motion.
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (e: MouseEvent) => {
      el.style.setProperty("--gx", `${e.clientX}px`);
      el.style.setProperty("--gy", `${e.clientY}px`);
      el.style.opacity = "1";
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-30 opacity-0 transition-opacity duration-500"
      style={{
        background:
          "radial-gradient(420px circle at var(--gx, 50%) var(--gy, 50%), rgba(155, 78, 42, 0.06), transparent 72%)",
        transition: "background 130ms linear, opacity 500ms ease",
      }}
    />
  );
}
