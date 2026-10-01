// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PSI_SOURCE_URL } from '@/lib/constants';
import { isPsiSnapshot } from '@/lib/psi/guards';

import { jsonResponse, pm25Response, psiResponse } from '../helpers';

let psiStatus = 200;

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/psi/route');
}

beforeEach(() => {
  psiStatus = 200;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === PSI_SOURCE_URL
        ? psiStatus === 200
          ? jsonResponse(psiResponse())
          : jsonResponse({}, psiStatus)
        : jsonResponse(pm25Response()),
    ),
  );
});

describe('GET /api/psi', () => {
  it('returns the snapshot with CDN caching for five minutes', async () => {
    const { GET } = await loadRoute();
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=600',
    );
    const body: unknown = await response.json();
    expect(isPsiSnapshot(body)).toBe(true);
    expect(body).toMatchObject({ stale: false, readingAt: '2026-09-28T08:00:00.000Z' });
  });

  it('serves the last good reading with a shorter cache when upstream fails', async () => {
    const { GET } = await loadRoute();
    await GET();
    psiStatus = 429;

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    expect(await response.json()).toMatchObject({ stale: true });
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns 502 without caching when there is no data at all', async () => {
    psiStatus = 500;
    const { GET } = await loadRoute();

    const response = await GET();
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'PSI data is unavailable right now.' });
  });

  it('sends the DATAGOV_KEY environment variable as the API key', async () => {
    vi.stubEnv('DATAGOV_KEY', 'test-key');
    const { GET } = await loadRoute();
    await GET();

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).toMatchObject({ 'x-api-key': 'test-key' });
    vi.unstubAllEnvs();
  });
});
