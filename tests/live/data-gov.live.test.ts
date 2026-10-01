import { describe, expect, it } from 'vitest';

import { PM25_SOURCE_URL, PSI_SOURCE_URL } from '@/lib/constants';
import { isRecord } from '@/lib/psi/guards';
import { parsePm25Response, parsePsiResponse } from '@/lib/psi/parse';
import { REGION_IDS } from '@/lib/psi/types';

const headers: HeadersInit = process.env.DATAGOV_KEY
  ? { 'x-api-key': process.env.DATAGOV_KEY }
  : {};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers });
  expect(response.status, `${url} status`).toBe(200);
  return response.json();
}

describe('live data.gov.sg API', () => {
  it('returns a PSI response the parser understands', async () => {
    const json = await getJson(PSI_SOURCE_URL);
    const parsed = parsePsiResponse(json);

    // Logged so a CI run shows the real shape next to what the parser assumes.
    const data = isRecord(json) && isRecord(json.data) ? json.data : {};
    const item = Array.isArray(data.items) && isRecord(data.items[0]) ? data.items[0] : {};
    console.info('PSI reading at', parsed.readingAt, parsed.psi);
    console.info('Region metadata', JSON.stringify(data.regionMetadata));
    console.info('Reading keys', isRecord(item.readings) ? Object.keys(item.readings) : item);

    const withReadings = REGION_IDS.filter((id) => parsed.psi[id] !== null);
    expect(withReadings.length).toBeGreaterThanOrEqual(4);
    expect(Date.now() - Date.parse(parsed.readingAt)).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('returns a PM2.5 response the parser understands', async () => {
    const parsed = parsePm25Response(await getJson(PM25_SOURCE_URL));
    console.info('PM2.5 one-hour', parsed);
    expect(REGION_IDS.some((id) => parsed[id] !== null)).toBe(true);
  });
});
