import { describe, expect, it } from 'vitest';

import { bandFor, PSI_BANDS } from '@/lib/psi/bands';

describe('bandFor', () => {
  it.each([
    [0, 'good', 'Good'],
    [50, 'good', 'Good'],
    [51, 'moderate', 'Moderate'],
    [100, 'moderate', 'Moderate'],
    [101, 'unhealthy', 'Unhealthy'],
    [200, 'unhealthy', 'Unhealthy'],
    [201, 'very-unhealthy', 'Very unhealthy'],
    [300, 'very-unhealthy', 'Very unhealthy'],
    [301, 'hazardous', 'Hazardous'],
    [500, 'hazardous', 'Hazardous'],
  ])('puts PSI %i in the %s band', (psi, id, label) => {
    expect(bandFor(psi)).toMatchObject({ id, label });
  });

  it('puts fractional values between bands in the higher band', () => {
    expect(bandFor(50.5).id).toBe('moderate');
    expect(bandFor(100.2).id).toBe('unhealthy');
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (psi) => {
    expect(() => bandFor(psi)).toThrow(RangeError);
  });

  it('covers every PSI value from 0 upwards without gaps', () => {
    PSI_BANDS.slice(1).forEach((band, index) => {
      expect(band.min).toBe(PSI_BANDS[index].max + 1);
    });
    expect(PSI_BANDS[0].min).toBe(0);
    expect(PSI_BANDS.at(-1)?.max).toBe(Infinity);
  });
});
