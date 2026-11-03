import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareerFlow SG — Autonomous Career Workflow Engine",
  description: "Meta AI Hackathon 2026 — End-to-end job search workflow for Singapore, powered by Muse Spark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
