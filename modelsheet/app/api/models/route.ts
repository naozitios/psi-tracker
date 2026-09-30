import { z } from "zod";
import { buildWorkbook } from "@/lib/model/build";
import { createModel, listModels } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { hit, LIMITS } from "@/lib/server/ratelimit";
import { HttpError, readJson, tooMany, withUser } from "@/lib/server/route";
import { HOUR, padCik, secFetchJson } from "@/lib/sec/client";
import { extractFinancials, type CompanyFacts } from "@/lib/sec/extract";
import { loadCompanyProfile } from "@/lib/sec/submissions";

export async function GET(request: Request) {
  // A first visit has no session yet, which just means no models.
  const whenAnonymous = () => Response.json({ models: [] });
  return withUser(request, { create: false, whenAnonymous }, async ({ db, userId }) =>
    Response.json({ models: await listModels(db, userId) }),
  );
}

const CreateBody = z.object({
  cik: z.string().regex(/^\d{1,10}$/),
  ticker: z.string().max(12).optional(),
});

// Builds a three-statement model from the company's 10-K XBRL data and
// saves it for the caller.
export async function POST(request: Request) {
  return withUser(request, { create: true }, async ({ db, userId }) => {
    const body = await readJson(request, CreateBody);
    const limit = await hit(db, `build:${userId}`, LIMITS.buildsPerUserHour, 3600);
    if (!limit.ok) throw tooMany("You've built a lot of models this hour. Try again later.", limit.retryAfter);

    const started = Date.now();
    const profile = await loadCompanyProfile(db, body.cik);
    if (!profile.supported) throw new HttpError(422, profile.unsupportedReason!);
    const facts = await secFetchJson<CompanyFacts>(
      db,
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(body.cik)}.json`,
      HOUR,
    );
    const extraction = extractFinancials(facts);
    if (extraction.periods.length === 0) {
      throw new HttpError(422, "No annual figures found in this company's XBRL data.");
    }
    const workbook = buildWorkbook(extraction, { ticker: body.ticker || profile.tickers[0] || "" });
    const id = await createModel(db, userId, workbook);
    await track(db, {
      name: "model_built",
      userId,
      modelId: id,
      props: { ticker: workbook.company.ticker, cik: workbook.company.cik, ms: Date.now() - started },
    });
    return Response.json({ id }, { status: 201 });
  });
}
