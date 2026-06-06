import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bus Rush",
  description: "When to leave, and whether to switch buses early or stay on.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f3f2ef",
};

// Geist — a clean neo-grotesque, used as a stand-in for Söhne until the licensed
// font is dropped in. Self-hosted by the package, so no build-time fetch.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
