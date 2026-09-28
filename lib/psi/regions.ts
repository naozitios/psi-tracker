import { MAX_REGION_DISTANCE_KM } from '../constants';
import type { LatLng, RegionId, RegionReading } from './types';

export const REGION_NAMES: Record<RegionId, string> = {
  west: 'West',
  east: 'East',
  central: 'Central',
  south: 'South',
  north: 'North',
};

export const DEFAULT_REGION: RegionId = 'central';

// Used only when the API omits a region's label location.
export const FALLBACK_REGION_LOCATIONS: Record<RegionId, LatLng> = {
  west: { latitude: 1.35735, longitude: 103.7 },
  east: { latitude: 1.35735, longitude: 103.94 },
  central: { latitude: 1.35735, longitude: 103.82 },
  south: { latitude: 1.29587, longitude: 103.82 },
  north: { latitude: 1.41803, longitude: 103.82 },
};

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function nearestRegion(
  position: LatLng,
  regions: readonly RegionReading[],
): { id: RegionId; distanceKm: number } | null {
  let best: { id: RegionId; distanceKm: number } | null = null;
  for (const region of regions) {
    const distance = distanceKm(position, region.location);
    if (!best || distance < best.distanceKm) best = { id: region.id, distanceKm: distance };
  }
  return best;
}

export function regionForPosition(
  position: LatLng,
  regions: readonly RegionReading[],
): RegionId | null {
  const nearest = nearestRegion(position, regions);
  return nearest && nearest.distanceKm <= MAX_REGION_DISTANCE_KM ? nearest.id : null;
}

export function isRegionId(value: unknown): value is RegionId {
  return typeof value === 'string' && Object.hasOwn(REGION_NAMES, value);
}
