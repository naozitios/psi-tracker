import type { Queryable } from "../db";
import { HOUR, padCik, secFetchJson } from "./client";

export interface TickerEntry {
  cik: string;
  ticker: string;
  name: string;
}

interface RawTickerFile {
  [index: string]: { cik_str: number; ticker: string; title: string };
}

export async function loadTickers(db: Queryable): Promise<TickerEntry[]> {
  const raw = await secFetchJson<RawTickerFile>(
    db,
    "https://www.sec.gov/files/company_tickers.json",
    24 * HOUR,
  );
  return Object.values(raw).map((r) => ({
    cik: padCik(r.cik_str),
    ticker: r.ticker.toUpperCase(),
    name: r.title,
  }));
}

function normalizeTicker(value: string): string {
  // SEC lists class shares with a dash (BRK-B); people often type a dot.
  return value.trim().toUpperCase().replace(/[./\s]/g, "-");
}

/**
 * Finds companies for a ticker or name. An exact ticker match wins outright;
 * otherwise names containing every word of the query are returned, best first.
 */
export function searchTickers(
  entries: TickerEntry[],
  query: string,
  limit = 8,
): TickerEntry[] {
  const q = query.trim();
  if (!q) return [];

  const ticker = normalizeTicker(q);
  const exact = entries.filter((e) => e.ticker === ticker);
  if (exact.length) return exact.slice(0, limit);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: Array<{ entry: TickerEntry; score: number }> = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (!words.every((w) => name.includes(w))) continue;
    const score = (name.startsWith(words[0]) ? 0 : 1) * 1000 + name.length;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score);

  // SEC lists one row per share class; keep the first ticker per company.
  const seen = new Set<string>();
  const out: TickerEntry[] = [];
  for (const { entry } of scored) {
    if (seen.has(entry.cik)) continue;
    seen.add(entry.cik);
    out.push(entry);
    if (out.length === limit) break;
  }
  return out;
}
