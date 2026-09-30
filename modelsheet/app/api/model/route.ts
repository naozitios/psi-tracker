import { buildWorkbook } from "@/lib/model/build";
import { jsonError, secErrorResponse } from "@/lib/http";
import { HOUR, padCik, secFetchJson } from "@/lib/sec/client";
import { extractFinancials, type CompanyFacts } from "@/lib/sec/extract";
import { loadCompanyProfile } from "@/lib/sec/submissions";

// POST { cik, ticker } builds a three-statement model from the company's
// 10-K XBRL data.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { cik?: string; ticker?: string } | null;
  const cik = body?.cik?.trim();
  if (!cik || !/^\d{1,10}$/.test(cik)) return jsonError("Invalid CIK.", 400);

  try {
    const profile = await loadCompanyProfile(cik);
    if (!profile.supported) return jsonError(profile.unsupportedReason!, 422);

    const facts = await secFetchJson<CompanyFacts>(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(cik)}.json`,
      HOUR,
    );
    const extraction = extractFinancials(facts);
    if (extraction.periods.length === 0) {
      return jsonError("No annual figures found in this company's XBRL data.", 422);
    }
    const workbook = buildWorkbook(extraction, {
      ticker: body?.ticker || profile.tickers[0] || "",
    });
    return Response.json({ workbook });
  } catch (err) {
    return secErrorResponse(err, "SEC has no XBRL financial data for this company.");
  }
}
