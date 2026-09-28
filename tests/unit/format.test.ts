import { describe, expect, it } from 'vitest';

import { formatReadingTime, isReadingOutdated } from '@/lib/format';

describe('formatReadingTime', () => {
  it('shows only the Singapore time for a reading from today', () => {
    expect(
      formatReadingTime('2026-09-28T08:00:00.000Z', new Date('2026-09-28T09:10:00.000Z')),
    ).toBe('4:00 pm');
  });

  it('adds the date when the reading is from an earlier day in Singapore', () => {
    expect(
      formatReadingTime('2026-09-28T15:00:00.000Z', new Date('2026-09-29T01:00:00.000Z')),
    ).toBe('28 Sep, 11:00 pm');
  });

  it('uses Singapore days, not UTC days', () => {
    // 00:30 SGT on the 29th is still the 28th in UTC.
    expect(
      formatReadingTime('2026-09-28T16:00:00.000Z', new Date('2026-09-28T16:30:00.000Z')),
    ).toBe('12:00 am');
  });
});

describe('isReadingOutdated', () => {
  const reading = '2026-09-28T08:00:00.000Z';
  const at = (iso: string) => Date.parse(iso);

  it('is false within two hours of the reading', () => {
    expect(isReadingOutdated(reading, at('2026-09-28T09:59:00.000Z'))).toBe(false);
  });

  it('is true once the reading is more than two hours old', () => {
    expect(isReadingOutdated(reading, at('2026-09-28T10:01:00.000Z'))).toBe(true);
  });
});
