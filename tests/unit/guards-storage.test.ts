import { describe, expect, it, vi } from 'vitest';

import { REGION_STORAGE_KEY } from '@/lib/constants';
import { isPsiSnapshot } from '@/lib/psi/guards';
import { readStoredRegion, writeStoredRegion } from '@/lib/storage';

import { makeSnapshot } from '../helpers';

describe('isPsiSnapshot', () => {
  it('accepts a snapshot from the API route', () => {
    expect(isPsiSnapshot(makeSnapshot())).toBe(true);
    expect(isPsiSnapshot(makeSnapshot({ values: { east: { psi: null, pm25: null } } }))).toBe(true);
  });

  it.each([
    ['null', null],
    ['an error body', { error: 'PSI data is unavailable right now.' }],
    ['no regions', { ...makeSnapshot(), regions: [] }],
    [
      'an unknown region',
      { ...makeSnapshot(), regions: [{ ...makeSnapshot().regions[0], id: 'x' }] },
    ],
    ['a string PSI', { ...makeSnapshot(), regions: [{ ...makeSnapshot().regions[0], psi: '9' }] }],
    [
      'a missing location',
      { ...makeSnapshot(), regions: [{ ...makeSnapshot().regions[0], location: null }] },
    ],
  ])('rejects %s', (_, value) => {
    expect(isPsiSnapshot(value)).toBe(false);
  });
});

describe('stored region', () => {
  it('round-trips a region through localStorage', () => {
    expect(readStoredRegion()).toBeNull();
    writeStoredRegion('north');
    expect(window.localStorage.getItem(REGION_STORAGE_KEY)).toBe('north');
    expect(readStoredRegion()).toBe('north');
  });

  it('ignores values that are not regions', () => {
    window.localStorage.setItem(REGION_STORAGE_KEY, 'national');
    expect(readStoredRegion()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(readStoredRegion()).toBeNull();
    expect(() => writeStoredRegion('west')).not.toThrow();
  });
});
