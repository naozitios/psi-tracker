import { NEA_HAZE_URL } from '@/lib/constants';
import { REGION_IDS } from '@/lib/psi/types';

import {
  BAND_PILL,
  EYEBROW,
  HERO_STACK,
  META,
  NOTE_ROW,
  READING,
  REGION_NAME,
  TAG_ROW,
} from './headline-layout';
import { ArrowUpRight } from './icons';

// Real text, made invisible, gives each placeholder the exact size of what replaces it.
const PLACEHOLDER = 'skeleton text-transparent select-none';

export function LoadingHero() {
  return (
    <>
      <div className={HERO_STACK}>
        <span className="sr-only">Loading the latest PSI readings</span>
        <p className={TAG_ROW} />
        <p className={EYEBROW}>24-hour PSI</p>
        <div aria-hidden="true" className="flex flex-col items-center">
          <div className={`${REGION_NAME} ${PLACEHOLDER} rounded-lg`}>Central</div>
          <div className={`${READING} ${PLACEHOLDER} rounded-2xl`}>88</div>
          <div className={`${BAND_PILL} ${PLACEHOLDER}`}>Moderate</div>
        </div>
        <div aria-hidden="true" className={META}>
          <p>
            <span className={`${PLACEHOLDER} rounded-md`}>PM2.5 00 µg/m³ in the past hour</span>
          </p>
          <p>
            <span className={`${PLACEHOLDER} rounded-md`}>Updated 00:00 pm</span>
          </p>
        </div>
      </div>
      <div className={NOTE_ROW} />
    </>
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
