// Brand logo chips for the landing page.
//
// Strategy (after a long pivot — see session transcript):
//   - simple-icons v11 supplies official SVG paths for 11 brands (Slack,
//     Salesforce, Anthropic, Supabase, HubSpot, Notion, Calendly, Loom,
//     Zoom, Apollo-as-Apollographql, Fathom). simple-icons removed most
//     other corporate logos in v15+ due to trademark concerns, and even
//     v11 doesn't carry LinkedIn / Gong / DocuSign / Outreach / etc.
//   - For the 4 iconic missing brands (LinkedIn, Gong, Outreach,
//     DocuSign) we hand-draw recognizable approximations from their
//     visual identity (rounded "in" badge, circle-arc, chevron stack,
//     yellow DS badge).
//   - For the long-tail B2B brands without recognizable shapes, we keep
//     branded letter glyphs. Each spec has a single `glyph` field; to
//     swap in an official SVG later, replace the glyph with a custom
//     SVG component for that brand.
//   - Clay keeps its own custom multi-color dome (built earlier).
//
// To override any brand's mark with a pasted official SVG:
//   1. Add a new glyph component below (e.g. `function PandadocOfficial()`)
//   2. Replace the brand's `glyph:` field with `<PandadocOfficial />`
//   3. Optionally set `glyphScale: 1` if the logo should fill the chip.

import {
  siSlack,
  siSalesforce,
  siSupabase,
  siHubspot,
  siNotion,
  siLoom,
  siZoom,
  siApollographql,
  siFathom,
} from "simple-icons";
// Note: simple-icons v11 does NOT export siAnthropic or siCalendly.
// Both are hand-drawn below (AnthropicGlyph, CalendlyGlyph).
import { cn } from "@/lib/utils";
import { BrandImage } from "./brand-image";

interface LogoProps {
  size?: number;
  className?: string;
  title?: string;
}

interface BrandSpec {
  bg: string;
  fg: string;
  glyph: React.ReactNode; // Fallback when `domain` is not set.
  name: string;
  // Fraction of the chip the glyph should fill. Defaults to 0.55.
  // Set to 1.0 for full-bleed multi-color logos (e.g. Clay).
  glyphScale?: number;
  // If set, the chip renders the real brand logo from the Brandfetch CDN
  // (https://docs.brandfetch.com/cdn). Falls back to the inline `glyph`
  // only if `domain` is omitted. Brandfetch client IDs are designed to be
  // public — see BRANDFETCH_CLIENT_ID below.
  domain?: string;
}

// ---------------------------------------------------------------------------
// Helper to render a simple-icons SVG path. Takes the icon object directly
// (typed loosely — simple-icons exports each as an object with a `.path`
// field plus metadata). The chip's foreground color controls the fill.
// ---------------------------------------------------------------------------

interface SimpleIconData {
  path: string;
  title?: string;
  hex?: string;
}

function SimpleIcon({ icon }: { icon: SimpleIconData }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-full h-full"
      aria-hidden
    >
      <path d={icon.path} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Brand registry. Single source of truth.
// ---------------------------------------------------------------------------

const BRANDS: Record<string, BrandSpec> = {
  // ── Brands with official simple-icons SVGs ────────────────────────────
  slack: {
    name: "Slack",
    bg: "#4A154B",
    fg: "white",
    glyph: <SimpleIcon icon={siSlack} />,
    domain: "slack.com",
  },
  salesforce: {
    name: "Salesforce",
    bg: "#00A1E0",
    fg: "white",
    glyph: <SimpleIcon icon={siSalesforce} />,
    domain: "salesforce.com",
  },
  anthropic: {
    name: "Anthropic",
    bg: "#CC785C",
    fg: "white",
    glyph: <AnthropicGlyph />,
    // No `domain`: Logo.dev returns Anthropic's corporate "AI" wordmark on
    // a cream background, which doesn't match the Claude app icon look
    // people recognize. Render the inline starburst glyph instead.
  },
  supabase: {
    name: "Supabase",
    bg: "#3ECF8E",
    fg: "white",
    glyph: <SimpleIcon icon={siSupabase} />,
    domain: "supabase.com",
  },
  hubspot: {
    name: "HubSpot",
    bg: "#FF7A59",
    fg: "white",
    glyph: <SimpleIcon icon={siHubspot} />,
    domain: "hubspot.com",
  },
  notion: {
    name: "Notion",
    bg: "#FAFAFA",
    fg: "#0A0E14",
    glyph: <SimpleIcon icon={siNotion} />,
    domain: "notion.so",
  },
  calendly: {
    name: "Calendly",
    bg: "#006BFF",
    fg: "white",
    glyph: <CalendlyGlyph />,
    domain: "calendly.com",
  },
  loom: {
    name: "Loom",
    bg: "#625DF5",
    fg: "white",
    glyph: <SimpleIcon icon={siLoom} />,
    domain: "loom.com",
  },
  zoom: {
    name: "Zoom",
    bg: "#2D8CFF",
    fg: "white",
    glyph: <SimpleIcon icon={siZoom} />,
    domain: "zoom.us",
  },
  apollo: {
    name: "Apollo",
    bg: "#1B27D9",
    fg: "white",
    glyph: <SimpleIcon icon={siApollographql} />,
    domain: "apollo.io",
  },
  fathom: {
    name: "Fathom",
    bg: "#F97316",
    fg: "white",
    glyph: <SimpleIcon icon={siFathom} />,
    domain: "fathom.video",
  },

  // ── Hand-drawn approximations of iconic missing brands ────────────────
  linkedin: {
    name: "LinkedIn",
    bg: "#0A66C2",
    fg: "white",
    glyph: <LinkedInGlyph />,
    domain: "linkedin.com",
  },
  gong: {
    name: "Gong",
    bg: "#7C3AED",
    fg: "white",
    glyph: <GongGlyph />,
    domain: "gong.io",
  },
  outreach: {
    name: "Outreach",
    bg: "#5951FF",
    fg: "white",
    glyph: <OutreachGlyph />,
    domain: "outreach.io",
  },
  docusign: {
    name: "DocuSign",
    bg: "#FFCC22",
    fg: "#0A0E14",
    glyph: <DocuSignGlyph />,
    domain: "docusign.com",
  },

  // ── Custom multi-color: Clay (built earlier; brand identity is the
  //    three-color nested dome). ────────────────────────────────────────
  clay: {
    name: "Clay",
    bg: "#FAFAFA",
    fg: "transparent",
    glyph: <ClayGlyph />,
    glyphScale: 1,
    domain: "clay.com",
  },

  // ── Letter-glyph long tail. Recognizable by brand color, distinguished
  //    by first letter. Override individually by replacing `glyph:` with
  //    a custom SVG component for that brand. ──────────────────────────
  granola: {
    name: "Granola",
    bg: "#A6C13B",
    fg: "#1A1A1A",
    glyph: <GranolaGlyph />,
    // No `domain`: Logo.dev serves a painterly variant from the web brand
    // that reads as low-fidelity at chip size. Render the inline spiral
    // glyph instead, which matches the macOS app-icon look.
  },
  newsapi: {
    name: "NewsAPI",
    bg: "#0F172A",
    fg: "white",
    glyph: <NewspaperGlyph />,
    domain: "newsapi.org",
  },
  sec: {
    name: "SEC EDGAR",
    bg: "#1E3A8A",
    fg: "white",
    glyph: <LetterGlyph letter="§" />,
    domain: "sec.gov",
  },
  firecrawl: {
    name: "Firecrawl",
    bg: "#F97316",
    fg: "white",
    glyph: <LetterGlyph letter="F" />,
    domain: "firecrawl.dev",
  },
  dock: {
    name: "Dock",
    bg: "#1F2937",
    fg: "white",
    glyph: <LetterGlyph letter="D" />,
    domain: "dock.us",
  },
  chilipiper: {
    name: "Chili Piper",
    bg: "#EF4444",
    fg: "white",
    glyph: <ChiliGlyph />,
    domain: "chilipiper.com",
  },
  zoominfo: {
    name: "ZoomInfo",
    bg: "#E60000",
    fg: "white",
    glyph: <ZoomInfoGlyph />,
    domain: "zoominfo.com",
  },
  pipedrive: {
    name: "Pipedrive",
    bg: "#027438",
    fg: "white",
    glyph: <PipedriveGlyph />,
    domain: "pipedrive.com",
  },
  attio: {
    name: "Attio",
    bg: "#FAFAFA",
    fg: "#0A0E14",
    glyph: <LetterGlyph letter="A" />,
    domain: "attio.com",
  },
  chorus: {
    name: "Chorus",
    bg: "#00BFA5",
    fg: "white",
    glyph: <LetterGlyph letter="C" />,
    domain: "chorus.ai",
  },
  tldv: {
    name: "tl;dv",
    bg: "#FF4757",
    fg: "white",
    glyph: <LetterGlyph letter="tl" small />,
    domain: "tldv.io",
  },
  salesloft: {
    name: "Salesloft",
    bg: "#F5F5F0",
    fg: "#0E4B47",
    glyph: <SalesloftGlyph />,
    domain: "salesloft.com",
  },
  mixmax: {
    name: "Mixmax",
    bg: "#D6336C",
    fg: "white",
    glyph: <LetterGlyph letter="M" />,
    domain: "mixmax.com",
  },
  aligned: {
    name: "Aligned",
    bg: "#7C3AED",
    fg: "white",
    glyph: <LetterGlyph letter="A" />,
    domain: "alignedup.com",
  },
  trumpet: {
    name: "Trumpet",
    bg: "#FB923C",
    fg: "white",
    glyph: <LetterGlyph letter="T" />,
    domain: "sendtrumpet.com",
  },
  calcom: {
    name: "Cal.com",
    bg: "#111827",
    fg: "white",
    glyph: <LetterGlyph letter="C" />,
    domain: "cal.com",
  },
  leadiq: {
    name: "LeadIQ",
    bg: "#0EA5E9",
    fg: "white",
    glyph: <LetterGlyph letter="L" />,
    domain: "leadiq.com",
  },
  cognism: {
    name: "Cognism",
    bg: "#0F172A",
    fg: "#10B981",
    glyph: <CircleDotGlyph />,
    domain: "cognism.com",
  },
  pandadoc: {
    name: "PandaDoc",
    bg: "#3CC07B",
    fg: "white",
    glyph: <PandaDocGlyph />,
    domain: "pandadoc.com",
  },
  nooks: {
    name: "Nooks",
    bg: "#6366F1",
    fg: "white",
    glyph: <LetterGlyph letter="N" />,
    domain: "nooks.ai",
  },
  swyftai: {
    name: "Swyft AI",
    bg: "#0EA5E9",
    fg: "white",
    glyph: <LetterGlyph letter="S" />,
    domain: "swyftai.com",
  },
  xero: {
    name: "Xero",
    bg: "#13B5EA",
    fg: "white",
    glyph: <LetterGlyph letter="X" />,
    domain: "xero.com",
  },
  zendesk: {
    name: "Zendesk",
    bg: "#03363D",
    fg: "white",
    glyph: <LetterGlyph letter="Z" />,
    domain: "zendesk.com",
  },
  webflow: {
    name: "Webflow",
    bg: "#146EF5",
    fg: "white",
    glyph: <LetterGlyph letter="W" />,
    domain: "webflow.com",
  },
};

// Public API — render a single branded chip.
//
// When the spec has a `domain`, the chip fetches the real logomark from
// Logo.dev via the BrandImage client island, falling back to the inline
// glyph if the request fails or NEXT_PUBLIC_LOGO_DEV_TOKEN is missing.
// BrandImage is split out so this file stays server-renderable (getBrandName
// is called from server components).
//
// When `domain` is absent, we render the inline glyph directly.
export function BrandLogo({
  brand,
  size = 40,
  className,
  title,
}: LogoProps & { brand: keyof typeof BRANDS }) {
  const spec = BRANDS[brand];
  if (!spec) return null;
  const dim = `${size}px`;
  const label = title ?? spec.name;

  const glyphChip = (
    <div
      className={cn(
        "rounded-[8px] flex items-center justify-center shrink-0",
        className,
      )}
      style={{
        width: dim,
        height: dim,
        backgroundColor: spec.bg,
        color: spec.fg,
      }}
      role="img"
      aria-label={label}
      title={label}
    >
      <div
        style={{
          width: `${Math.round(size * (spec.glyphScale ?? 0.55))}px`,
          height: `${Math.round(size * (spec.glyphScale ?? 0.55))}px`,
        }}
        className="flex items-center justify-center"
      >
        {spec.glyph}
      </div>
    </div>
  );

  if (spec.domain) {
    return (
      <BrandImage
        domain={spec.domain}
        bg={spec.bg}
        size={size}
        alt={label}
        title={label}
        className={className}
        fallback={glyphChip}
      />
    );
  }

  return glyphChip;
}

export function getBrandName(brand: keyof typeof BRANDS): string {
  return BRANDS[brand]?.name ?? brand;
}

export type BrandKey = keyof typeof BRANDS;

// ===========================================================================
// Glyph components
// ===========================================================================

function LetterGlyph({
  letter,
  small = false,
}: {
  letter: string;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-bold tracking-tight leading-none",
        small ? "text-[0.7em]" : "text-[0.95em]",
      )}
      style={{ fontFamily: "var(--font-geist-sans), sans-serif" }}
    >
      {letter}
    </span>
  );
}

function CircleDotGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-full h-full">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </svg>
  );
}

function NewspaperGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="w-full h-full"
    >
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <line x1="7" y1="9" x2="17" y2="9" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="15" x2="13" y2="15" />
    </svg>
  );
}

function ChiliGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M9 3c1 1 2 1 3 0v3c0 5-3 9-8 12l-1-2c4-2 6-5 6-9V3z" />
    </svg>
  );
}

// LinkedIn — the iconic rounded "in" badge. White wordmark on the chip's
// LinkedIn-blue background, no extra inner box since the chip itself is
// the badge.
function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      {/* lowercase "i" — dot above a vertical bar */}
      <circle cx="5.5" cy="6" r="2" />
      <rect x="3.5" y="9.5" width="4" height="11" />
      {/* lowercase "n" — vertical bar + arch */}
      <path d="M10 9.5h4v1.5c.8-1 2-1.8 3.5-1.8 2.7 0 4.5 1.8 4.5 5v6.3h-4v-5.8c0-1.5-.7-2.3-2-2.3s-2 .8-2 2.3v5.8h-4V9.5z" />
    </svg>
  );
}

// Gong — purple chip with a stylized gong (struck disc with motion arcs).
// Approximated as concentric ring + dot + soundwave arcs on either side.
function GongGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="w-full h-full"
    >
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <path d="M3 9c1.5 1 1.5 5 0 6" />
      <path d="M21 9c-1.5 1-1.5 5 0 6" />
    </svg>
  );
}

// Outreach — stacked chevrons pointing up (their iconic "going up and to
// the right" arrow mark, simplified to two chevrons).
function OutreachGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-full h-full"
    >
      <polyline points="5 13 12 6 19 13" />
      <polyline points="5 19 12 12 19 19" opacity="0.55" />
    </svg>
  );
}

// DocuSign — bold "DS" monogram on the yellow chip. Their actual mark is
// a yellow rounded square with "DS" forward-slash glyph.
function DocuSignGlyph() {
  return (
    <span
      className="font-black tracking-tight leading-none text-[0.85em]"
      style={{
        fontFamily: "var(--font-geist-sans), sans-serif",
        letterSpacing: "-0.05em",
      }}
    >
      DS
    </span>
  );
}

// Anthropic — stylized 8-point burst / sparkle mark, approximating their
// asterisk-style logomark. Two crossed strokes in white on the clay-orange
// chip; reads as a starburst.
function AnthropicGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-full h-full"
      aria-hidden
    >
      {/* Vertical bar */}
      <rect x="11" y="2" width="2" height="20" rx="1" />
      {/* Horizontal bar */}
      <rect x="2" y="11" width="20" height="2" rx="1" />
      {/* Diagonal accents */}
      <rect
        x="11"
        y="2"
        width="2"
        height="20"
        rx="1"
        transform="rotate(45 12 12)"
        opacity="0.7"
      />
      <rect
        x="11"
        y="2"
        width="2"
        height="20"
        rx="1"
        transform="rotate(-45 12 12)"
        opacity="0.7"
      />
    </svg>
  );
}

// Calendly — calendar mark: rounded square frame with a single filled dot
// representing a booked event. Matches their actual logomark vibe.
function CalendlyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="w-full h-full"
      aria-hidden
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <circle cx="12" cy="15" r="1.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Pipedrive — bold lowercase "p" with a circular bowl + descender stem.
// White glyph on the brand's forest-green chip; inner counter cutout matches
// the chip bg so the loop reads as a hole.
function PipedriveGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" aria-hidden>
      {/* Stem + bowl outline as one filled path */}
      <path
        d="M3.5 3 H8.5 V8 A6.5 6.5 0 1 1 8.5 17 V22 H3.5 Z"
        fill="currentColor"
      />
      {/* Counter cutout — matches chip bg (#027438) to look like a hole */}
      <circle cx="13" cy="11" r="2.5" fill="#027438" />
    </svg>
  );
}

// Salesloft — serif italic "S" with a small lime-green accent dot, on the
// brand's cream chip. The serif S uses SVG text with a Georgia/Times
// fallback rather than a path so we don't have to hand-trace serif curves.
function SalesloftGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" aria-hidden>
      <text
        x="2"
        y="20"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="22"
        fontWeight="700"
        fontStyle="italic"
        fill="currentColor"
      >
        S
      </text>
      {/* Lime accent dot at lower-right */}
      <circle cx="19" cy="17" r="2.2" fill="#B5D33A" />
    </svg>
  );
}

// PandaDoc — connected "pd" mark. Two overlapping circular bowls with
// straight stems on the outer edges; counters cut out with the chip's
// green so the bowls read as hollow rings. The 1-unit overlap between
// circles creates a single visually-merged "pd" silhouette.
function PandaDocGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" aria-hidden>
      {/* p: outer stem + bowl */}
      <path d="M2.5 4 H6 V22 H2.5 V4 Z" fill="currentColor" />
      <circle cx="8" cy="9" r="5" fill="currentColor" />
      <circle cx="8" cy="9" r="2.2" fill="#3CC07B" />
      {/* d: outer stem + bowl (mirrored) */}
      <path d="M18 4 H21.5 V22 H18 V4 Z" fill="currentColor" />
      <circle cx="16" cy="9" r="5" fill="currentColor" />
      <circle cx="16" cy="9" r="2.2" fill="#3CC07B" />
    </svg>
  );
}

// Granola — hand-painted-style inward spiral. Approximated with five
// consecutive half-arcs of decreasing radius, rendered as a thick stroked
// path with rounded caps to suggest a brush stroke. Won't match the
// organic brush feel of the actual logo, but reads as "spiral" from
// across the room.
function GranolaGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-full h-full"
      aria-hidden
    >
      <path d="M 18 4 A 9 9 0 1 1 4 11 A 7 7 0 1 1 19 13 A 5 5 0 1 1 7 13 A 3 3 0 1 1 15 12.5 A 1 1 0 1 1 12 11.5" />
    </svg>
  );
}

// ZoomInfo — stylized Z built from two opposing frame-corner brackets
// (top-left + bottom-right), a thick diagonal stripe, and an up-right
// arrow indicator. Approximated from a raster source so the proportions
// are eyeballed; replace with the official SVG when available.
function ZoomInfoGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-full h-full"
      aria-hidden
    >
      {/* Top-left frame corner */}
      <path d="M3 3 H10 V5.5 H5.5 V10 H3 V3 Z" />
      {/* Bottom-right frame corner */}
      <path d="M21 21 H14 V18.5 H18.5 V14 H21 V21 Z" />
      {/* Diagonal stripe — thick band running from lower-left to upper-right */}
      <path d="M7 16.5 L16.5 7 L19 9.5 L9.5 19 Z" />
      {/* Up-right expand arrow at the top-right corner */}
      <path d="M14 4 H20 V10 H17.5 V7.5 L13 12 L11.5 10.5 L16 6 H14 V4 Z" />
    </svg>
  );
}

// Clay's nested-dome mark — kept from earlier session. Three concentric
// arches sitting on a flat baseline: blue outer shell, pink middle arch,
// yellow inner doorway. Multi-color so it ignores the parent chip's fg.
function ClayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-full h-full" aria-hidden>
      <path
        d="M 1 23 L 1 12 Q 1 3 12 3 Q 23 3 23 12 L 23 23 Z"
        fill="#15B0F8"
      />
      <path
        d="M 5 23 L 5 14 Q 5 8 12 8 Q 19 8 19 14 L 19 23 Z"
        fill="#FF8FA3"
      />
      <path
        d="M 9 23 L 9 16 Q 9 13 12 13 Q 15 13 15 16 L 15 23 Z"
        fill="#FCD34D"
      />
    </svg>
  );
}
