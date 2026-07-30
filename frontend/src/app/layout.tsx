import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WalkSafe-AI | Pedestrian Safety Dashboard",
  description:
    "Interactive dashboard for visualizing pedestrian safety risk at intersections in Philadelphia. Built on empirical Bayes analysis of PennDOT crash data.",
  keywords: [
    "pedestrian safety",
    "Philadelphia",
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
        <Navbar />
        <main className="pt-14">{children}</main>
      </body>
    </html>
  );
}
