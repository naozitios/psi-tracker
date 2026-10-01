import type { Band } from './types';

export const PSI_BANDS = [
  { id: 'good', label: 'Good', min: 0, max: 50 },
  { id: 'moderate', label: 'Moderate', min: 51, max: 100 },
  { id: 'unhealthy', label: 'Unhealthy', min: 101, max: 200 },
  { id: 'very-unhealthy', label: 'Very unhealthy', min: 201, max: 300 },
  { id: 'hazardous', label: 'Hazardous', min: 301, max: Infinity },
] as const satisfies readonly Band[];

export function bandFor(psi: number): Band {
  if (!Number.isFinite(psi) || psi < 0) {
    throw new RangeError(`PSI must be a non-negative number, got ${psi}`);
  }
  // Matching on each band's upper bound puts fractional values like 50.5 in the higher band.
  return PSI_BANDS.find((band) => psi <= band.max) ?? PSI_BANDS[PSI_BANDS.length - 1];
}
