import { describe, expect, it } from "vitest";
import { filingIndexUrl, padCik } from "@/lib/sec/client";
import { summarizeSubmissions, type RawSubmissions } from "@/lib/sec/submissions";
import { searchTickers, type TickerEntry } from "@/lib/sec/tickers";

const entries: TickerEntry[] = [
  { cik: "0000320193", ticker: "AAPL", name: "Apple Inc." },
  { cik: "0001067983", ticker: "BRK-B", name: "BERKSHIRE HATHAWAY INC" },
  { cik: "0001067983", ticker: "BRK-A", name: "BERKSHIRE HATHAWAY INC" },
  { cik: "0000789019", ticker: "MSFT", name: "MICROSOFT CORP" },
  { cik: "0001234567", ticker: "APLE", name: "Apple Hospitality REIT, Inc." },
];

describe("searchTickers (PRD F1)", () => {
  it("matches tickers exactly, including class shares typed with a dot", () => {
    expect(searchTickers(entries, "aapl").map((e) => e.ticker)).toEqual(["AAPL"]);
    expect(searchTickers(entries, "brk.b").map((e) => e.ticker)).toEqual(["BRK-B"]);
  });

  it("falls back to company names, one row per company", () => {
    expect(searchTickers(entries, "berkshire").map((e) => e.ticker)).toEqual(["BRK-B"]);
    expect(searchTickers(entries, "apple").map((e) => e.ticker)).toEqual(["AAPL", "APLE"]);
    expect(searchTickers(entries, "nothing like this")).toEqual([]);
  });
});

function submissions(overrides: Partial<RawSubmissions> = {}): RawSubmissions {
  return {
    cik: "320193",
    name: "Apple Inc.",
    tickers: ["AAPL"],
    sic: "3571",
    sicDescription: "Electronic Computers",
    fiscalYearEnd: "0927",
    filings: {
      recent: {
        accessionNumber: ["0000320193-24-000123", "0000320193-24-000081", "0000320193-23-000106"],
        form: ["10-K", "10-Q", "10-K"],
        filingDate: ["2024-11-01", "2024-08-02", "2023-11-03"],
        reportDate: ["2024-09-28", "2024-06-29", "2023-09-30"],
      },
    },
    ...overrides,
  };
}

describe("summarizeSubmissions", () => {
  it("lists the annual reports a model will use", () => {
    const profile = summarizeSubmissions(submissions());
    expect(profile.supported).toBe(true);
    expect(profile.cik).toBe("0000320193");
    expect(profile.annualReports.map((r) => r.accessionNumber)).toEqual([
      "0000320193-24-000123",
      "0000320193-23-000106",
    ]);
    expect(profile.annualReports[0].url).toBe(filingIndexUrl(320193, "0000320193-24-000123"));
  });

  it("turns away banks, insurers and companies without 10-Ks", () => {
    expect(summarizeSubmissions(submissions({ sic: "6021" })).unsupportedReason).toMatch(/Banks/);
    expect(summarizeSubmissions(submissions({ sic: "6311" })).unsupportedReason).toMatch(/Insurers/);
    const foreign = submissions();
    foreign.filings.recent.form = ["20-F", "6-K", "20-F"];
    expect(summarizeSubmissions(foreign).unsupportedReason).toMatch(/20-F or 40-F/);
    const busyFiler = submissions();
    busyFiler.filings.recent.form = ["4", "4", "8-K"];
    expect(summarizeSubmissions(busyFiler).supported).toBe(true);
  });
});

describe("padCik", () => {
  it("zero-pads to ten digits", () => {
    expect(padCik(320193)).toBe("0000320193");
  });
});
