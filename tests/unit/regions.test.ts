import { describe, expect, it } from 'vitest';

import {
  distanceKm,
  isRegionId,
  nearestRegion,
  regionForPosition,
  REGION_NAMES,
} from '@/lib/psi/regions';
import { REGION_IDS } from '@/lib/psi/types';

import { makeSnapshot, PLACES } from '../helpers';

const { regions } = makeSnapshot();

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(PLACES.bishan, PLACES.bishan)).toBe(0);
  });

  it('matches the known distance from Jurong East to Changi Airport', () => {
    expect(distanceKm(PLACES.jurongEast, PLACES.changiAirport)).toBeCloseTo(27.8, 0);
  });

  it('is symmetric', () => {
    expect(distanceKm(PLACES.woodlands, PLACES.marinaBay)).toBeCloseTo(
      distanceKm(PLACES.marinaBay, PLACES.woodlands),
      9,
    );
  });
});

describe('nearest region', () => {
  it.each([
    ['Jurong East', PLACES.jurongEast, 'west'],
    ['Changi Airport', PLACES.changiAirport, 'east'],
    ['Bishan', PLACES.bishan, 'central'],
    ['Marina Bay', PLACES.marinaBay, 'south'],
    ['Woodlands', PLACES.woodlands, 'north'],
  ] as const)('places %s in the %s region', (_, position, expected) => {
    expect(regionForPosition(position, regions)).toBe(expected);
  });

  it('uses the label locations it is given', () => {
    const moved = regions.map((region) =>
      region.id === 'east' ? { ...region, location: PLACES.jurongEast } : region,
    );
    expect(regionForPosition(PLACES.jurongEast, moved)).toBe('east');
  });

  it('returns no region for a position outside Singapore', () => {
    expect(nearestRegion(PLACES.kualaLumpur, regions)?.distanceKm).toBeGreaterThan(250);
    expect(regionForPosition(PLACES.kualaLumpur, regions)).toBeNull();
  });

  it('returns nothing when there are no regions', () => {
    expect(nearestRegion(PLACES.bishan, [])).toBeNull();
    expect(regionForPosition(PLACES.bishan, [])).toBeNull();
  });
});

describe('isRegionId', () => {
  it('accepts the five PSI regions', () => {
    REGION_IDS.forEach((id) => expect(isRegionId(id)).toBe(true));
    expect(Object.keys(REGION_NAMES)).toEqual([...REGION_IDS]);
  });

  it.each(['national', 'toString', '', null, 3])('rejects %s', (value) => {
    expect(isRegionId(value)).toBe(false);
  });
});
