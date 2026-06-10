import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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

// Söhne (Klim) — licensed, self-hosted. 400/400i/500/600 woff2 only; keep the
// files out of any public distribution beyond serving the app itself.
const soehne = localFont({
  src: [
    { path: "./fonts/soehne-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/soehne-400i.woff2", weight: "400", style: "italic" },
    { path: "./fonts/soehne-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/soehne-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-soehne",
  display: "swap",
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={soehne.variable}>
      <body>{children}</body>
    </html>
  );
}
