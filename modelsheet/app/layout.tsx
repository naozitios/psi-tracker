import type { Metadata } from "next";
import Link from "next/link";
import { DISCLAIMER } from "@/lib/disclaimer";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelSheet",
  description: "Build an auditable company model from SEC filings, then edit it in plain English.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app">
          <header className="topbar">
            <Link href="/" className="brand">
              ModelSheet
            </Link>
            <span className="company" />
            <Link href="/" className="small">
              Your models
            </Link>
          </header>
          <p className="disclaimer" role="note">
            {DISCLAIMER}
          </p>
          {children}
        </div>
      </body>
    </html>
  );
}
