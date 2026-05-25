"use client";

// Client island for BrandLogo. Renders the brand logomark from Logo.dev,
// falling back to the inline glyph if the request fails or the token is
// missing. Kept separate from logos.tsx so getBrandName / BRANDS stay
// server-renderable.
// server-renderable.
//
// Source history (see commit log for context):
//   - Brandfetch → 302'd without a paid client ID
//   - Google favicons → 16×16 for most brands, looked pixelated
//   - Clearbit → DNS dead (HubSpot shut it down 2025/2026)
//   - icon.horse → returned ~35px favicons, looked worse than Google
//   - Logo.dev (current) → real 192×192 brand logomarks, free with a
//     publishable pk_ token; safe to expose in client bundle.

import { useState } from "react";
import { cn } from "@/lib/utils";

const LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

const LOGO_DEV_URL = (domain: string, size: number) =>
  `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=${size}&format=png&retina=true`;

export function BrandImage({
  domain,
  bg,
  size,
  alt,
  title,
  className,
  fallback,
}: {
  domain: string;
  bg: string;
  size: number;
  alt: string;
  title: string;
  className?: string;
  // Rendered when Logo.dev fails or the token is missing. JSX (not a
  // function) because functions can't cross the server→client boundary.
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const dim = `${size}px`;

  if (failed || !LOGO_DEV_TOKEN) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_DEV_URL(domain, Math.max(128, size * 4))}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("rounded-[8px] shrink-0 object-contain p-1", className)}
      style={{ width: dim, height: dim, backgroundColor: bg }}
      title={title}
    />
  );
}
