// Server-only access to SEC EDGAR. SEC's fair-access policy requires a
// User-Agent naming the caller and caps traffic at 10 requests per second.
// https://www.sec.gov/os/accessing-edgar-data

export class SecConfigError extends Error {}

export class SecRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MIN_INTERVAL_MS = 125;
// companyfacts responses run to several MB, so keep only recent ones.
const MAX_CACHE_ENTRIES = 40;
const cache = new Map<string, { expires: number; data: unknown }>();
let nextSlot = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function userAgent(): string {
  const value = process.env.SEC_USER_AGENT?.trim();
  if (!value) {
    throw new SecConfigError(
      "SEC_USER_AGENT is not set. SEC requires a name and contact email, e.g. \"ModelSheet you@example.com\".",
    );
  }
  return value;
}

export async function secFetchJson<T>(url: string, ttlMs: number): Promise<T> {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.data as T;

  const headers = { "User-Agent": userAgent(), Accept: "application/json" };
  await throttle();
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new SecRequestError(`SEC request failed (${res.status}) for ${url}`, res.status);
  }
  const data = (await res.json()) as T;
  cache.delete(url);
  cache.set(url, { expires: Date.now() + ttlMs, data });
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return data;
}

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

export function filingIndexUrl(cik: string | number, accessionNumber: string): string {
  const folder = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${folder}/${accessionNumber}-index.htm`;
}

export const HOUR = 60 * 60 * 1000;
