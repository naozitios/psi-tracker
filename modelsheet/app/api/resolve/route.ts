import { jsonError, secErrorResponse } from "@/lib/http";
import { loadCompanyProfile } from "@/lib/sec/submissions";
import { loadTickers, searchTickers } from "@/lib/sec/tickers";

// GET ?q=<ticker or name> lists matching companies.
// GET ?cik=<cik> returns the company and the 10-K filings a model will use.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const cik = params.get("cik");
  const query = params.get("q");

  try {
    if (cik) {
      if (!/^\d{1,10}$/.test(cik)) return jsonError("Invalid CIK.", 400);
      return Response.json({ profile: await loadCompanyProfile(cik) });
    }
    if (!query?.trim()) return jsonError("Enter a ticker or company name.", 400);
    const matches = searchTickers(await loadTickers(), query.slice(0, 100));
    return Response.json({ matches });
  } catch (err) {
    return secErrorResponse(err, "Company not found on SEC EDGAR.");
  }
}
