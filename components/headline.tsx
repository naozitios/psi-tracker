import type { RegionReading } from '@/lib/psi/types';
import { formatReadingTime } from '@/lib/format';
import { bandFor } from '@/lib/psi/bands';
import { REGION_NAMES } from '@/lib/psi/regions';

import { LocationArrow } from './icons';
import { PANEL_ID, tabId } from './ids';

type HeadlineProps = {
  reading: RegionReading;
  readingAt: string;
  receivedAt: number;
  outdated: boolean;
  tag: 'location' | 'locating' | null;
};

export function Headline({ reading, readingAt, receivedAt, outdated, tag }: HeadlineProps) {
  const band = reading.psi === null ? null : bandFor(reading.psi);

  return (
    <section
      id={PANEL_ID}
      role="tabpanel"
      aria-labelledby={tabId(reading.id)}
      data-band={band?.id ?? 'none'}
      className="relative flex flex-col items-center text-center"
    >
      <div
        aria-hidden="true"
        className="band-glow absolute top-1/2 left-1/2 -z-10 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
      />

      <p className="eyebrow flex min-h-7 items-center gap-2.5">
        24-hour PSI
        {tag && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.6875rem] tracking-[0.12em] text-text">
            {tag === 'location' ? (
              <>
                <LocationArrow />
                Your location
              </>
            ) : (
              'Locating…'
            )}
          </span>
        )}
      </p>

      <div key={reading.id} className="rise flex flex-col items-center">
        <h2 className="mt-5 font-display text-[clamp(2.75rem,12vw,4.75rem)] leading-none font-normal tracking-[0.03em] uppercase">
          {REGION_NAMES[reading.id]}
        </h2>
        <p className="display-number mt-5 text-[clamp(8.5rem,40vw,13.5rem)]">
          <span className="sr-only">PSI </span>
          {reading.psi ?? '—'}
        </p>
        <p className="mt-7 inline-flex items-center gap-2 rounded-full border border-hairline bg-surface px-4 py-1.5 text-sm font-medium backdrop-blur-md">
          <span aria-hidden="true" className="size-2 rounded-full bg-band" />
          <span className="text-band">{band ? band.label : 'No reading'}</span>
        </p>
      </div>

      <p className="mt-6 max-w-sm text-[0.9375rem] leading-relaxed text-muted">
        {reading.pm25 !== null && (
          <>
            PM2.5 <span className="text-text tabular-nums">{reading.pm25}</span> µg/m³ in the past
            hour ·{' '}
          </>
        )}
        Updated {formatReadingTime(readingAt, new Date(receivedAt))}
      </p>

      {outdated && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-copper-light/30 px-3.5 py-1 text-[0.8125rem] font-medium text-copper-light">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-copper-light" />
          May be outdated
          <span className="sr-only">. Showing the last reading received.</span>
        </p>
      )}
    </section>
  );
}
