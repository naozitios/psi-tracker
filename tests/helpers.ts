import pm25Fixture from './fixtures/pm25-response.json';
import psiFixture from './fixtures/psi-response.json';

import type { PsiSnapshot, RegionId } from '@/lib/psi/types';
import { FALLBACK_REGION_LOCATIONS } from '@/lib/psi/regions';

export const clone = <T>(value: T): T => structuredClone(value);

export const psiResponse = () => clone(psiFixture);
export const pm25Response = () => clone(pm25Fixture);

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const DEFAULT_VALUES: Record<RegionId, { psi: number | null; pm25: number | null }> = {
  west: { psi: 104, pm25: 38 },
  east: { psi: 87, pm25: 22 },
  central: { psi: 93, pm25: 27 },
  south: { psi: 99, pm25: 31 },
  north: { psi: 112, pm25: 47 },
};

export function makeSnapshot(
  overrides: Partial<Omit<PsiSnapshot, 'regions'>> & {
    values?: Partial<Record<RegionId, { psi?: number | null; pm25?: number | null }>>;
  } = {},
): PsiSnapshot {
  const { values = {}, ...rest } = overrides;
  return {
    readingAt: new Date().toISOString(),
    stale: false,
    ...rest,
    regions: (Object.keys(DEFAULT_VALUES) as RegionId[]).map((id) => ({
      id,
      psi: values[id]?.psi !== undefined ? values[id].psi : DEFAULT_VALUES[id].psi,
      pm25: values[id]?.pm25 !== undefined ? values[id].pm25 : DEFAULT_VALUES[id].pm25,
      location: FALLBACK_REGION_LOCATIONS[id],
    })),
  };
}

export const PLACES = {
  jurongEast: { latitude: 1.3329, longitude: 103.7436 },
  changiAirport: { latitude: 1.3644, longitude: 103.9915 },
  bishan: { latitude: 1.3508, longitude: 103.8485 },
  marinaBay: { latitude: 1.2834, longitude: 103.8607 },
  woodlands: { latitude: 1.4382, longitude: 103.789 },
  kualaLumpur: { latitude: 3.139, longitude: 101.6869 },
} as const;
