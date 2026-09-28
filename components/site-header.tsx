import Link from 'next/link';

import { APP_NAME, NEA_HAZE_URL } from '@/lib/constants';

import { ArrowUpRight, Mark } from './icons';

export function SiteHeader() {
  return (
    <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-[max(env(safe-area-inset-top),1.25rem)] sm:px-8 sm:pt-8">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-md text-[1.375rem] font-semibold tracking-tight"
      >
        <Mark />
        {APP_NAME}
      </Link>
      <a
        href={NEA_HAZE_URL}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[#f5f5f5] px-4 text-[0.9375rem] font-medium text-black transition-colors hover:bg-white"
      >
        NEA haze advisory
        <ArrowUpRight />
      </a>
    </header>
  );
}
