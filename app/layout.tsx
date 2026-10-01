import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Geist } from 'next/font/google';

import { APP_NAME } from '@/lib/constants';

import './globals.css';

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400'],
  variable: '--font-cormorant',
});

// Apple devices render SF Pro from the system stack, so only other platforms fetch Geist.
const sans = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  preload: false,
});

export const metadata: Metadata = {
  title: `${APP_NAME} · Singapore PSI`,
  description:
    "Singapore's 24-hour PSI for where you are right now, with one-tap switching between regions.",
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-SG" className={`${display.variable} ${sans.variable}`}>
      <body className="min-h-svh">{children}</body>
    </html>
  );
}
