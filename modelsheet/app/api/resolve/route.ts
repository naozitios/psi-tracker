import { handle, HttpError, tooMany } from "@/lib/server/route";
import { hit, LIMITS } from "@/lib/server/ratelimit";
import { clientIp } from "@/lib/server/session";
import { loadCompanyProfile } from "@/lib/sec/submissions";
import { loadTickers, searchTickers } from "@/lib/sec/tickers";

// GET ?q=<ticker or name> lists matching companies.
// GET ?cik=<cik> returns the company and the 10-K filings a model will use.
export async function GET(request: Request) {
  return handle(async (db) => {
    const limit = await hit(db, `search:${clientIp(request)}`, LIMITS.searchesPerIpMinute, 60);
    if (!limit.ok) throw tooMany("Too many searches. Wait a moment and try again.", limit.retryAfter);

    const params = new URL(request.url).searchParams;
    const cik = params.get("cik");
    const query = params.get("q");
    if (cik) {
      if (!/^\d{1,10}$/.test(cik)) throw new HttpError(400, "Invalid CIK.");
      return Response.json({ profile: await loadCompanyProfile(db, cik) });
    }
    if (!query?.trim()) throw new HttpError(400, "Enter a ticker or company name.");
    return Response.json({ matches: searchTickers(await loadTickers(db), query.slice(0, 100)) });
  });
}
