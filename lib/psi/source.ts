import { CACHE_SECONDS, PM25_SOURCE_URL, PSI_SOURCE_URL, UPSTREAM_TIMEOUT_MS } from '../constants';
import { buildSnapshot, parsePm25Response, parsePsiResponse } from './parse';
import type { PsiSnapshot } from './types';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type PsiSourceOptions = {
  fetch?: FetchLike;
  apiKey?: string;
  timeoutMs?: number;
  onFallback?: (error: unknown) => void;
  onPm25Error?: (error: unknown) => void;
};

export class UpstreamHttpError extends Error {
  name = 'UpstreamHttpError';

  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`${url} responded ${status}`);
  }
}

export function createPsiSource({
  // Resolve fetch per call so Next's patched fetch (and test mocks) are picked up.
  fetch: fetchImpl = (input, init) => fetch(input, init),
  apiKey,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  onFallback,
  onPm25Error,
}: PsiSourceOptions = {}): () => Promise<PsiSnapshot> {
  let lastGood: PsiSnapshot | null = null;

  async function fetchJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url, {
      headers: apiKey
        ? { accept: 'application/json', 'x-api-key': apiKey }
        : { accept: 'application/json' },
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new UpstreamHttpError(response.status, url);
    return response.json();
  }

  return async function getSnapshot() {
    const [psi, pm25] = await Promise.allSettled([
      fetchJson(PSI_SOURCE_URL).then(parsePsiResponse),
      fetchJson(PM25_SOURCE_URL).then(parsePm25Response),
    ]);

    if (psi.status === 'fulfilled') {
      if (pm25.status === 'rejected') onPm25Error?.(pm25.reason);
      lastGood = buildSnapshot(psi.value, pm25.status === 'fulfilled' ? pm25.value : null);
      return lastGood;
    }

    if (lastGood) {
      onFallback?.(psi.reason);
      return { ...lastGood, stale: true };
    }
    throw psi.reason;
  };
}
