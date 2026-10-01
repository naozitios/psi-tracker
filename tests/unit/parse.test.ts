import { describe, expect, it } from 'vitest';

import {
  buildSnapshot,
  parsePm25Response,
  parsePsiResponse,
  UpstreamShapeError,
} from '@/lib/psi/parse';
import { FALLBACK_REGION_LOCATIONS } from '@/lib/psi/regions';
import { REGION_IDS } from '@/lib/psi/types';

import { pm25Response, psiResponse } from '../helpers';

describe('parsePsiResponse', () => {
  it('reads the 24-hour PSI for all five regions', () => {
    expect(parsePsiResponse(psiResponse()).psi).toEqual({
      west: 104,
      east: 87,
      central: 93,
      south: 99,
      north: 112,
    });
  });

  it('uses the reading timestamp, normalised to UTC', () => {
    expect(parsePsiResponse(psiResponse()).readingAt).toBe('2026-09-28T08:00:00.000Z');
  });

  it('falls back to updatedTimestamp when timestamp is missing', () => {
    const json = psiResponse();
    delete (json.data.items[0] as { timestamp?: string }).timestamp;
    expect(parsePsiResponse(json).readingAt).toBe('2026-09-28T08:08:21.000Z');
  });

  it('takes region label locations from regionMetadata', () => {
    const json = psiResponse();
    json.data.regionMetadata[0].labelLocation = { latitude: 1.34, longitude: 103.71 };
    expect(parsePsiResponse(json).locations.west).toEqual({ latitude: 1.34, longitude: 103.71 });
  });

  it('keeps fallback locations when metadata is missing or points at 0,0', () => {
    const json = psiResponse();
    json.data.regionMetadata = [
      { name: 'east', labelLocation: { latitude: 0, longitude: 0 } },
      { name: 'national', labelLocation: { latitude: 1, longitude: 1 } },
    ];
    expect(parsePsiResponse(json).locations).toEqual(FALLBACK_REGION_LOCATIONS);

    const withoutMetadata = psiResponse() as { data: Record<string, unknown> };
    delete withoutMetadata.data.regionMetadata;
    expect(parsePsiResponse(withoutMetadata).locations).toEqual(FALLBACK_REGION_LOCATIONS);
  });

  it('ignores a national reading and other extra keys', () => {
    const json = psiResponse();
    Object.assign(json.data.items[0].readings.psi_twenty_four_hourly, { national: 112 });
    expect(Object.keys(parsePsiResponse(json).psi)).toEqual([...REGION_IDS]);
  });

  it('marks missing or invalid region values as null', () => {
    const json = psiResponse();
    const readings = json.data.items[0].readings.psi_twenty_four_hourly as Record<string, unknown>;
    delete readings.north;
    readings.east = 'n/a';
    readings.west = -3;
    readings.south = '64';
    expect(parsePsiResponse(json).psi).toEqual({
      west: null,
      east: null,
      central: 93,
      south: 64,
      north: null,
    });
  });

  it('rounds fractional readings', () => {
    const json = psiResponse();
    json.data.items[0].readings.psi_twenty_four_hourly.central = 92.6;
    expect(parsePsiResponse(json).psi.central).toBe(93);
  });

  it.each([
    ['a non-object body', 'oops'],
    ['an API error code', { code: 17, errorMsg: 'Rate limited', data: null }],
    ['no items', { code: 0, data: { items: [] } }],
    ['no data', { code: 0 }],
  ])('rejects %s', (_, body) => {
    expect(() => parsePsiResponse(body)).toThrow(UpstreamShapeError);
  });

  it('includes the API error message in the error', () => {
    expect(() => parsePsiResponse({ code: 17, errorMsg: 'Rate limited' })).toThrow(/Rate limited/);
  });

  it('rejects a response without psi_twenty_four_hourly', () => {
    const json = psiResponse() as { data: { items: { readings: Record<string, unknown> }[] } };
    delete json.data.items[0].readings.psi_twenty_four_hourly;
    expect(() => parsePsiResponse(json)).toThrow(/psi_twenty_four_hourly/);
  });

  it('rejects a response where every region is missing', () => {
    const json = psiResponse() as { data: { items: { readings: Record<string, unknown> }[] } };
    json.data.items[0].readings.psi_twenty_four_hourly = { national: 80 };
    expect(() => parsePsiResponse(json)).toThrow(/no region values/);
  });

  it('rejects an invalid timestamp', () => {
    const json = psiResponse();
    json.data.items[0].timestamp = 'yesterday';
    json.data.items[0].updatedTimestamp = 'yesterday';
    expect(() => parsePsiResponse(json)).toThrow(/timestamp/);
  });
});

describe('parsePm25Response', () => {
  it('reads the one-hour PM2.5 for each region', () => {
    expect(parsePm25Response(pm25Response())).toEqual({
      west: 38,
      east: 22,
      central: 27,
      south: 31,
      north: 47,
    });
  });

  it('rejects a response without pm25_one_hourly', () => {
    expect(() => parsePm25Response(psiResponse())).toThrow(/pm25_one_hourly/);
  });
});

describe('buildSnapshot', () => {
  it('combines PSI and PM2.5 per region in tab order', () => {
    const snapshot = buildSnapshot(
      parsePsiResponse(psiResponse()),
      parsePm25Response(pm25Response()),
    );
    expect(snapshot.stale).toBe(false);
    expect(snapshot.readingAt).toBe('2026-09-28T08:00:00.000Z');
    expect(snapshot.regions.map((region) => region.id)).toEqual([...REGION_IDS]);
    expect(snapshot.regions[1]).toEqual({
      id: 'east',
      psi: 87,
      pm25: 22,
      location: { latitude: 1.35735, longitude: 103.94 },
    });
  });

  it('leaves PM2.5 empty when it is unavailable', () => {
    const snapshot = buildSnapshot(parsePsiResponse(psiResponse()), null);
    expect(snapshot.regions.every((region) => region.pm25 === null)).toBe(true);
  });
});
