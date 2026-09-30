import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModelSheet",
  description: "Build an auditable company model from SEC filings, then edit it in plain English.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
