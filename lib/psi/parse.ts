import { isRecord } from './guards';
import { FALLBACK_REGION_LOCATIONS, isRegionId } from './regions';
import { REGION_IDS, type LatLng, type PsiSnapshot, type RegionId } from './types';

type RegionValues = Record<RegionId, number | null>;

export type ParsedPsi = {
  readingAt: string;
  psi: RegionValues;
  locations: Record<RegionId, LatLng>;
};

export class UpstreamShapeError extends Error {
  name = 'UpstreamShapeError';
}

function latestItem(json: unknown, source: string): Record<string, unknown> {
  if (!isRecord(json)) throw new UpstreamShapeError(`${source}: response is not an object`);
  if (json.code !== undefined && json.code !== 0) {
    const message = typeof json.errorMsg === 'string' && json.errorMsg ? json.errorMsg : 'unknown';
    throw new UpstreamShapeError(`${source}: API error code ${String(json.code)} (${message})`);
  }
  const data = json.data;
  if (!isRecord(data) || !Array.isArray(data.items) || !isRecord(data.items[0])) {
    throw new UpstreamShapeError(`${source}: no readings in response`);
  }
  return data.items[0];
}

function readingValue(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0
    ? Math.round(number)
    : null;
}

function regionValues(readings: unknown, key: string, source: string): RegionValues {
  if (!isRecord(readings) || !isRecord(readings[key])) {
    throw new UpstreamShapeError(`${source}: missing ${key}`);
  }
  const byRegion = readings[key];
  const values = Object.fromEntries(
    REGION_IDS.map((id) => [id, readingValue(byRegion[id])]),
  ) as RegionValues;
  if (REGION_IDS.every((id) => values[id] === null)) {
    throw new UpstreamShapeError(`${source}: ${key} has no region values`);
  }
  return values;
}

function regionLocations(data: unknown): Record<RegionId, LatLng> {
  const locations = { ...FALLBACK_REGION_LOCATIONS };
  const metadata = isRecord(data) && Array.isArray(data.regionMetadata) ? data.regionMetadata : [];
  for (const entry of metadata) {
    if (!isRecord(entry) || !isRecord(entry.labelLocation)) continue;
    const id = entry.name;
    const { latitude, longitude } = entry.labelLocation;
    if (
      isRegionId(id) &&
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      !(latitude === 0 && longitude === 0)
    ) {
      locations[id] = { latitude, longitude };
    }
  }
  return locations;
}

function readingTimestamp(item: Record<string, unknown>, source: string): string {
  const raw = item.timestamp ?? item.updatedTimestamp;
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    throw new UpstreamShapeError(`${source}: missing or invalid timestamp`);
  }
  return new Date(raw).toISOString();
}

export function parsePsiResponse(json: unknown): ParsedPsi {
  const item = latestItem(json, 'PSI');
  return {
    readingAt: readingTimestamp(item, 'PSI'),
    psi: regionValues(item.readings, 'psi_twenty_four_hourly', 'PSI'),
    locations: regionLocations(isRecord(json) ? json.data : undefined),
  };
}

export function parsePm25Response(json: unknown): RegionValues {
  const item = latestItem(json, 'PM2.5');
  return regionValues(item.readings, 'pm25_one_hourly', 'PM2.5');
}

export function buildSnapshot(psi: ParsedPsi, pm25: RegionValues | null): PsiSnapshot {
  return {
    readingAt: psi.readingAt,
    stale: false,
    regions: REGION_IDS.map((id) => ({
      id,
      psi: psi.psi[id],
      pm25: pm25?.[id] ?? null,
      location: psi.locations[id],
    })),
  };
}
