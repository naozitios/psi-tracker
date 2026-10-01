import type { RegionReading } from '@/lib/psi/types';
import { formatReadingTime } from '@/lib/format';
import { bandFor } from '@/lib/psi/bands';
import { REGION_NAMES } from '@/lib/psi/regions';

import {
  BAND_PILL,
  EYEBROW,
  HERO_STACK,
  META,
  READING,
  REGION_NAME,
  TAG_ROW,
} from './headline-layout';
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
      className={HERO_STACK}
    >
      <div
        aria-hidden="true"
        className="band-glow absolute top-1/2 left-1/2 -z-10 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
      />

      <p className={TAG_ROW}>
        {tag && (
          <span
            key={tag}
            className="swap inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.6875rem] font-medium tracking-[0.12em] text-text uppercase"
          >
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
      <p className={EYEBROW}>24-hour PSI</p>

      <div key={reading.id} className="swap flex flex-col items-center">
        <h2 className={REGION_NAME}>{REGION_NAMES[reading.id]}</h2>
        <p className={READING}>
          <span className="sr-only">PSI </span>
          {reading.psi ?? '—'}
        </p>
        <p className={BAND_PILL}>
          <span aria-hidden="true" className="size-2 rounded-full bg-band" />
          <span className="text-band">{band ? band.label : 'No reading'}</span>
        </p>
      </div>

      <div className={META}>
        {reading.pm25 !== null && (
          <p>
            PM2.5 <span className="text-text tabular-nums">{reading.pm25}</span> µg/m³ in the past
            hour
          </p>
        )}
        <p>
          Updated {formatReadingTime(readingAt, new Date(receivedAt))}
          {outdated && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="font-medium text-copper-light">May be outdated</span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
