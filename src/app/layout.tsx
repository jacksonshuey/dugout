import type { Metadata } from "next";
import { Inter, Fraunces, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { AmbientGlow, CursorGlow } from "@/components/cursor-glow";

// Fonts match Jackson's personal site: Inter for body, Fraunces for the
// display serif used in headings, Geist Mono retained for code-style
// metadata (pkey labels, source paths, field schemas).
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dugout",
  description:
    "Centralized knowledge layer so no AE walks into a meeting cold. Every tool, every signal, every news cycle synthesized into the next action. Built by Jackson Shuey.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AmbientGlow />
        <CursorGlow />
        <Nav />
        <main className="flex-1 min-h-0">{children}</main>
        <Analytics />
      </body>
    </html>
  );
}
