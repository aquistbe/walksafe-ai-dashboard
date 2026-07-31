import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
// A client component imported into a server layout. layout.tsx must NOT gain
// "use client" — it exports `metadata`, and that pairing is a build error.
import { CityProvider } from "@/lib/cityContext";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WalkSafe-AI | Pedestrian Safety Dashboard",
  description:
    "Interactive pedestrian safety dashboard. Philadelphia intersection crash rankings from PennDOT data, and Bogotá ZAT zone profiles from a published Street View built-environment extraction.",
  keywords: [
    "pedestrian safety",
    "Philadelphia",
    "Bogotá",
    "crash data",
    "Vision Zero",
    "WalkSafe-AI",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className="font-sans antialiased">
        <CityProvider>
          <Navbar />
          <main className="pt-14">{children}</main>
        </CityProvider>
      </body>
    </html>
  );
}
