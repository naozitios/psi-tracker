import type { Queryable } from "../db";
import { HOUR, filingIndexUrl, padCik, secFetchJson } from "./client";

export interface FilingSummary {
  form: string;
  accessionNumber: string;
  filed: string;
  periodEnd: string;
  url: string;
}

export interface CompanyProfile {
  cik: string;
  name: string;
  tickers: string[];
  sic: string;
  sicDescription: string;
  fiscalYearEnd: string;
  annualReports: FilingSummary[];
  supported: boolean;
  unsupportedReason?: string;
}

export interface RawSubmissions {
  cik: string;
  name: string;
  tickers?: string[];
  sic?: string;
  sicDescription?: string;
  fiscalYearEnd?: string;
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      reportDate: string[];
    };
  };
}

// Banks and insurers need different statement templates (PRD non-goal).
function unsupportedIndustry(sic: number): string | undefined {
  if (sic >= 6000 && sic <= 6099) return "Banks are not supported yet: their statements need a different template.";
  if (sic >= 6300 && sic <= 6411) return "Insurers are not supported yet: their statements need a different template.";
  return undefined;
}

export function summarizeSubmissions(raw: RawSubmissions, maxReports = 5): CompanyProfile {
  const recent = raw.filings.recent;
  const annualReports: FilingSummary[] = [];
  for (let i = 0; i < recent.form.length && annualReports.length < maxReports; i++) {
    if (recent.form[i] !== "10-K") continue;
    annualReports.push({
      form: recent.form[i],
      accessionNumber: recent.accessionNumber[i],
      filed: recent.filingDate[i],
      periodEnd: recent.reportDate[i],
      url: filingIndexUrl(raw.cik, recent.accessionNumber[i]),
    });
  }

  const sic = Number(raw.sic ?? 0);
  let unsupportedReason = unsupportedIndustry(sic);
  // "recent" covers roughly the last thousand filings, so a frequent filer's
  // older 10-Ks may be missing from it. Only a foreign annual report form is
  // a reliable sign the company never files 10-Ks.
  const filesForeignAnnualReports = recent.form.some((f) => f === "20-F" || f === "40-F");
  if (!unsupportedReason && annualReports.length === 0 && filesForeignAnnualReports) {
    unsupportedReason =
      "This company files 20-F or 40-F annual reports. Only US companies that file 10-Ks are supported.";
  }

  return {
    cik: padCik(raw.cik),
    name: raw.name,
    tickers: raw.tickers ?? [],
    sic: raw.sic ?? "",
    sicDescription: raw.sicDescription ?? "",
    fiscalYearEnd: raw.fiscalYearEnd ?? "",
    annualReports,
    supported: !unsupportedReason,
    unsupportedReason,
  };
}

export async function loadCompanyProfile(db: Queryable, cik: string): Promise<CompanyProfile> {
  const raw = await secFetchJson<RawSubmissions>(
    db,
    `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`,
    HOUR,
  );
  return summarizeSubmissions(raw);
}
