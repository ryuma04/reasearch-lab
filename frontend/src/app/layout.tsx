import type { Metadata, Viewport } from "next";
import { Fraunces, Poppins } from "next/font/google";
import { Providers } from "@/components/shell/providers";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", axes: ["SOFT", "WONK", "opsz"] });
const poppins = Poppins({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-poppins", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Research Lab — Evolving AI Research Environment", template: "%s · Research Lab" },
  description: "Give it a research paper. An evolving team of AI agents reproduces it, tests every claim with proof, explains the gaps and explores what-ifs.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f1e8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${poppins.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
