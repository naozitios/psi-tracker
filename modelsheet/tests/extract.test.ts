import { describe, expect, it } from "vitest";
import { extractFinancials, findAnnualPeriods } from "@/lib/sec/extract";
import {
  FISCAL_YEAR_ENDS,
  RESTATED_FY2022_REVENUE,
  buildCompanyFacts,
  figures,
  tenKAccession,
} from "./fixtures/companyfacts";

const facts = buildCompanyFacts();

describe("findAnnualPeriods", () => {
  it("returns the latest five fiscal years, oldest first, ignoring quarters", () => {
    const periods = findAnnualPeriods(facts);
    expect(periods.map((p) => p.label)).toEqual(["FY2020A", "FY2021A", "FY2022A", "FY2023A", "FY2024A"]);
    expect(periods.map((p) => p.end)).toEqual([2020, 2021, 2022, 2023, 2024].map((y) => FISCAL_YEAR_ENDS[y]));
    expect(periods[0].start).toBe("2019-09-29");
  });
});

describe("extractFinancials", () => {
  const extraction = extractFinancials(facts);
  const byYear = (key: string, year: number) => extraction.lines[key][year - 2020];

  it("scales values to millions and records the filing behind each one", () => {
    const revenue = byYear("revenue", 2024)!;
    expect(revenue.value).toBeCloseTo(391_000, 6);
    expect(revenue.source).toMatchObject({
      concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
      form: "10-K",
      accessionNumber: tenKAccession(2024),
      periodEnd: "2024-09-28",
      reportedValue: 391_000_000_000,
      unit: "USD",
    });
    expect(revenue.source.url).toBe(
      "https://www.sec.gov/Archives/edgar/data/1234567/000123456725000100/0001234567-25-000100-index.htm",
    );
  });

  it("prefers the most recent filing, so restated figures win", () => {
    const revenue = byYear("revenue", 2022)!;
    expect(revenue.value).toBeCloseTo(RESTATED_FY2022_REVENUE, 6);
    expect(revenue.source.accessionNumber).toBe(tenKAccession(2024));
  });

  it("falls back through concept names when a company changes tags", () => {
    // FY2020 appears under SalesRevenueNet (FY2020/21 10-Ks) and the ASC 606
    // concept (FY2022 10-K); the higher-priority concept wins.
    expect(byYear("revenue", 2020)!.source.concept).toBe(
      "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
    );
  });

  it("keeps per-share and share-count units straight", () => {
    const f = figures(2023);
    expect(byYear("dilutedEps", 2023)!.value).toBeCloseTo(f.eps, 9);
    expect(byYear("dilutedShares", 2023)!.value).toBeCloseTo(f.shares, 6);
  });

  it("flips the sign of cash payments", () => {
    expect(byYear("capex", 2024)!.value).toBeCloseTo(-figures(2024).capex, 6);
    expect(byYear("capex", 2024)!.source.reportedValue).toBeGreaterThan(0);
  });

  it("reads beginning cash from the prior year end", () => {
    expect(byYear("beginningCash", 2020)!.value).toBeCloseTo(48_000, 6);
    expect(byYear("beginningCash", 2020)!.source.periodEnd).toBe(FISCAL_YEAR_ENDS[2019]);
  });

  it("returns null where the filings have no value", () => {
    expect(extraction.lines.totalLiabilities.every((v) => v === null)).toBe(true);
    expect(extraction.lines.temporaryEquity.every((v) => v === null)).toBe(true);
  });
});
