import { isRegionId } from './regions';
import type { LatLng, PsiSnapshot, RegionReading } from './types';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNullableNumber = (value: unknown) => value === null || typeof value === 'number';

const isLatLng = (value: unknown): value is LatLng =>
  isRecord(value) && typeof value.latitude === 'number' && typeof value.longitude === 'number';

const isRegionReading = (value: unknown): value is RegionReading =>
  isRecord(value) &&
  isRegionId(value.id) &&
  isNullableNumber(value.psi) &&
  isNullableNumber(value.pm25) &&
  isLatLng(value.location);

export function isPsiSnapshot(value: unknown): value is PsiSnapshot {
  return (
    isRecord(value) &&
    typeof value.readingAt === 'string' &&
    typeof value.stale === 'boolean' &&
    Array.isArray(value.regions) &&
    value.regions.length > 0 &&
    value.regions.every(isRegionReading)
  );
}
