import { NEA_HAZE_URL } from '@/lib/constants';
import { REGION_IDS } from '@/lib/psi/types';

import { ArrowUpRight } from './icons';

export function LoadingHero() {
  return (
    <div className="flex flex-col items-center">
      <span className="sr-only">Loading the latest PSI readings</span>
      <p className="eyebrow flex min-h-7 items-center">24-hour PSI</p>
      <div className="skeleton mt-5 h-[clamp(2.75rem,12vw,4.75rem)] w-56 rounded-lg" />
      <div className="skeleton mt-5 h-[clamp(7rem,33vw,11rem)] w-44 rounded-2xl" />
      <div className="skeleton mt-7 h-8 w-28 rounded-full" />
      <div className="skeleton mt-6 h-5 w-64 rounded-md" />
    </div>
  );
}

export function LoadingTabs() {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-2xl border border-hairline bg-surface p-1">
      {REGION_IDS.map((id) => (
        <div key={id} className="skeleton min-h-14 rounded-xl" />
      ))}
    </div>
  );
}

export function ErrorHero({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex max-w-sm flex-col items-center text-center">
      <p className="eyebrow flex min-h-7 items-center">24-hour PSI</p>
      <h2 className="mt-5 font-display text-[clamp(2.5rem,11vw,4.25rem)] leading-none tracking-[0.03em] uppercase">
        Unavailable
      </h2>
      <p className="mt-6 text-[0.9375rem] leading-relaxed text-muted">
        We couldn&apos;t load the latest readings. Check your connection and try again.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-accent px-6 text-[0.9375rem] font-medium text-white transition-colors hover:bg-accent-hover"
      >
        Try again
      </button>
      <a
        href={NEA_HAZE_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm text-text underline-offset-4 hover:underline"
      >
        Check NEA&apos;s haze site
        <ArrowUpRight />
      </a>
    </div>
  );
}
