// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { PM25_SOURCE_URL, PSI_SOURCE_URL } from '@/lib/constants';
import { createPsiSource, UpstreamHttpError } from '@/lib/psi/source';

import { jsonResponse, pm25Response, psiResponse } from '../helpers';

type Reply = () => Response | Promise<Response>;

function fakeUpstream(replies: { psi: Reply; pm25?: Reply }) {
  return vi.fn(async (url: string) => {
    if (url === PSI_SOURCE_URL) return replies.psi();
    if (url === PM25_SOURCE_URL) return (replies.pm25 ?? (() => jsonResponse(pm25Response())))();
    throw new Error(`unexpected URL ${url}`);
  });
}

const ok = () => jsonResponse(psiResponse());

describe('createPsiSource', () => {
  it('fetches PSI and PM2.5 with a five-minute revalidate', async () => {
    const fetch = fakeUpstream({ psi: ok });
    await createPsiSource({ fetch })();

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect([PSI_SOURCE_URL, PM25_SOURCE_URL]).toContain(url);
      expect(init.next).toEqual({ revalidate: 300 });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('sends the API key only when one is configured', async () => {
    const withKey = fakeUpstream({ psi: ok });
    await createPsiSource({ fetch: withKey, apiKey: 'secret' })();
    const [, keyed] = withKey.mock.calls[0] as unknown as [string, RequestInit];
    expect(keyed.headers).toMatchObject({ 'x-api-key': 'secret' });

    const withoutKey = fakeUpstream({ psi: ok });
    await createPsiSource({ fetch: withoutKey })();
    const [, unkeyed] = withoutKey.mock.calls[0] as unknown as [string, RequestInit];
    expect(unkeyed.headers).not.toHaveProperty('x-api-key');
  });

  it('returns a fresh snapshot', async () => {
    const snapshot = await createPsiSource({ fetch: fakeUpstream({ psi: ok }) })();
    expect(snapshot.stale).toBe(false);
    expect(snapshot.regions.find((region) => region.id === 'north')).toMatchObject({
      psi: 112,
      pm25: 47,
    });
  });

  it('still returns PSI when PM2.5 fails', async () => {
    const onPm25Error = vi.fn();
    const snapshot = await createPsiSource({
      fetch: fakeUpstream({ psi: ok, pm25: () => jsonResponse({}, 500) }),
      onPm25Error,
    })();
    expect(snapshot.stale).toBe(false);
    expect(snapshot.regions.every((region) => region.pm25 === null)).toBe(true);
    expect(onPm25Error).toHaveBeenCalledWith(expect.any(UpstreamHttpError));
  });

  it('serves the last good reading, marked stale, when data.gov.sg rate-limits', async () => {
    let status = 200;
    const onFallback = vi.fn();
    const getSnapshot = createPsiSource({
      fetch: fakeUpstream({ psi: () => (status === 200 ? ok() : jsonResponse({}, status)) }),
      onFallback,
    });

    const fresh = await getSnapshot();
    status = 429;
    const fallback = await getSnapshot();

    expect(fallback).toEqual({ ...fresh, stale: true });
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ status: 429 }));
  });

  it('falls back when the network fails or the body is malformed', async () => {
    let reply: Reply = ok;
    const getSnapshot = createPsiSource({ fetch: fakeUpstream({ psi: () => reply() }) });
    await getSnapshot();

    reply = () => Promise.reject(new TypeError('fetch failed'));
    expect((await getSnapshot()).stale).toBe(true);

    reply = () => jsonResponse({ code: 0, data: { items: [] } });
    expect((await getSnapshot()).stale).toBe(true);
  });

  it('replaces the fallback with newer data once upstream recovers', async () => {
    let reply: Reply = ok;
    const getSnapshot = createPsiSource({ fetch: fakeUpstream({ psi: () => reply() }) });
    await getSnapshot();

    reply = () => jsonResponse({}, 503);
    await getSnapshot();

    const newer = psiResponse();
    newer.data.items[0].readings.psi_twenty_four_hourly.central = 71;
    reply = () => jsonResponse(newer);
    const recovered = await getSnapshot();
    expect(recovered.stale).toBe(false);
    expect(recovered.regions.find((region) => region.id === 'central')?.psi).toBe(71);
  });

  it('throws when upstream fails and nothing has been cached yet', async () => {
    const getSnapshot = createPsiSource({
      fetch: fakeUpstream({ psi: () => jsonResponse({}, 502) }),
    });
    await expect(getSnapshot()).rejects.toBeInstanceOf(UpstreamHttpError);
  });

  it('keeps separate fallbacks per source instance', async () => {
    const first = createPsiSource({ fetch: fakeUpstream({ psi: ok }) });
    await first();
    const second = createPsiSource({ fetch: fakeUpstream({ psi: () => jsonResponse({}, 500) }) });
    await expect(second()).rejects.toThrow();
  });
});
