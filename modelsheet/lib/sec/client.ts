import type { Queryable } from "../db";
import { hit, LIMITS } from "../server/ratelimit";

// Server-only access to SEC EDGAR. SEC's fair-access policy requires a
// User-Agent naming the caller and caps traffic at 10 requests per second
// per IP. Responses are cached in the database so every server instance
// shares them, and the request budget is counted there too.
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

// companyfacts responses run to several MB, so keep only recent ones in memory.
const MAX_MEMORY_ENTRIES = 20;
const memory = new Map<string, { expires: number; data: unknown }>();

function remember(url: string, data: unknown, expires: number) {
  memory.delete(url);
  memory.set(url, { expires, data });
  if (memory.size > MAX_MEMORY_ENTRIES) memory.delete(memory.keys().next().value!);
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

async function waitForSlot(db: Queryable): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const slot = await hit(db, "sec-requests", LIMITS.secRequestsPerSecond, 1);
    if (slot.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new SecRequestError("SEC request budget exhausted", 503);
}

export async function secFetchJson<T>(db: Queryable, url: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const hot = memory.get(url);
  if (hot && hot.expires > now) return hot.data as T;

  const [cached] = await db.query<{ body: string; fetched_at: Date }>(
    "SELECT body, fetched_at FROM sec_cache WHERE url = $1",
    [url],
  );
  if (cached) {
    const expires = new Date(cached.fetched_at).getTime() + ttlMs;
    if (expires > now) {
      const data = JSON.parse(cached.body) as T;
      remember(url, data, expires);
      return data;
    }
  }

  const headers = { "User-Agent": userAgent(), Accept: "application/json" };
  await waitForSlot(db);
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) {
    throw new SecRequestError(`SEC request failed (${res.status}) for ${url}`, res.status);
  }
  const body = await res.text();
  const data = JSON.parse(body) as T;
  await db.query(
    `INSERT INTO sec_cache (url, body, fetched_at) VALUES ($1, $2, now())
     ON CONFLICT (url) DO UPDATE SET body = EXCLUDED.body, fetched_at = EXCLUDED.fetched_at`,
    [url, body],
  );
  remember(url, data, now + ttlMs);
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
