import type { CompanyFacts, FactEntry } from "@/lib/sec/extract";

// A synthetic company whose statements tie out exactly, shaped like SEC's
// companyfacts API. Each 10-K reports three years of flows and two (or,
// for cash, four) balance sheet dates, so most periods appear in several
// filings. It also exercises the awkward parts of real data:
// - fiscal years end on a Saturday (52/53-week years)
// - revenue switches concept (SalesRevenueNet -> ASC 606) in the FY2022 10-K
// - FY2022 revenue is restated in later filings
// - 10-Q and fourth-quarter facts that must be ignored
// - no "Liabilities" total, so the model must derive it

export const CIK = 1234567;

export const FISCAL_YEAR_ENDS: Record<number, string> = {
  2018: "2018-09-29",
  2019: "2019-09-28",
  2020: "2020-09-26",
  2021: "2021-09-25",
  2022: "2022-09-24",
  2023: "2023-09-30",
  2024: "2024-09-28",
};

const REVENUE: Record<number, number> = {
  2018: 250_000, 2019: 260_000, 2020: 274_000, 2021: 365_000, 2022: 394_000, 2023: 383_000, 2024: 391_000,
};
export const RESTATED_FY2022_REVENUE = 394_100;
const SHARES: Record<number, number> = {
  2018: 17_500, 2019: 17_000, 2020: 16_500, 2021: 16_000, 2022: 15_800, 2023: 15_500, 2024: 15_300,
};
const CASH: Record<number, number> = {
  2017: 20_000, 2018: 25_000, 2019: 48_000, 2020: 38_000, 2021: 35_000, 2022: 24_000, 2023: 30_000, 2024: 29_000,
};

const M = 1_000_000;

export interface YearFigures {
  [key: string]: number;
}

/** Figures for one fiscal year in USD millions (shares in millions). */
export function figures(year: number, revenueOverride?: number): YearFigures {
  const revenue = revenueOverride ?? REVENUE[year];
  const costOfRevenue = 0.6 * revenue;
  const rd = 0.07 * revenue;
  const sga = 0.06 * revenue;
  const otherOpex = 0.01 * REVENUE[year];
  const operatingIncome = revenue - costOfRevenue - rd - sga - otherOpex;
  const pretaxIncome = operatingIncome + 0.005 * revenue;
  const incomeTax = 0.16 * pretaxIncome;
  const netIncome = pretaxIncome - incomeTax;

  const cash = CASH[year];
  const sti = 0.08 * revenue;
  const receivables = 0.1 * revenue;
  const inventory = 0.02 * revenue;
  const totalCurrentAssets = cash + sti + receivables + inventory + 0.05 * revenue;
  const ppe = 0.1 * revenue;
  const goodwill = 5_000;
  const totalAssets = totalCurrentAssets + ppe + goodwill + 0.3 * revenue;
  const accountsPayable = 0.15 * revenue;
  const shortTermDebt = 10_000;
  const totalCurrentLiabilities = accountsPayable + shortTermDebt + 0.12 * revenue;
  const longTermDebt = 100_000;
  const totalLiabilities = totalCurrentLiabilities + longTermDebt + 0.1 * revenue;
  const totalEquity = totalAssets - totalLiabilities;

  const da = 0.03 * revenue;
  const sbc = 0.025 * revenue;
  const cfo = netIncome + da + sbc + 0.01 * revenue;
  const capex = 0.03 * revenue;
  const cfi = -capex - 0.02 * revenue;
  const dividends = 14_000;
  const buybacks = 0.2 * revenue;
  const netChange = cash - CASH[year - 1];
  const cff = netChange - cfo - cfi;

  return {
    revenue, costOfRevenue, rd, sga, operatingIncome, pretaxIncome, incomeTax, netIncome,
    shares: SHARES[year], eps: netIncome / SHARES[year],
    cash, sti, receivables, inventory, totalCurrentAssets, ppe, goodwill, totalAssets,
    accountsPayable, shortTermDebt, totalCurrentLiabilities, longTermDebt, totalLiabilities,
    totalEquity, liabilitiesAndEquity: totalAssets,
    da, sbc, cfo, capex, cfi, dividends, buybacks, cff, netChange,
  };
}

function accessionFor(year: number, form = "10-K"): string {
  const seq = form === "10-K" ? 100 : 50;
  return `0001234567-${String(year + 1).slice(2)}-000${seq}`;
}

export function tenKAccession(fiscalYear: number): string {
  return accessionFor(fiscalYear);
}

function filedDate(fiscalYear: number): string {
  return `${fiscalYear}-11-0${fiscalYear % 7 + 1}`;
}

type Line = [concept: string, unit: string, key: string, kind: "duration" | "instant", scale?: number];

const DURATION_LINES: Line[] = [
  ["CostOfGoodsAndServicesSold", "USD", "costOfRevenue", "duration"],
  ["ResearchAndDevelopmentExpense", "USD", "rd", "duration"],
  ["SellingGeneralAndAdministrativeExpense", "USD", "sga", "duration"],
  ["OperatingIncomeLoss", "USD", "operatingIncome", "duration"],
  ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "USD", "pretaxIncome", "duration"],
  ["IncomeTaxExpenseBenefit", "USD", "incomeTax", "duration"],
  ["NetIncomeLoss", "USD", "netIncome", "duration"],
  ["WeightedAverageNumberOfDilutedSharesOutstanding", "shares", "shares", "duration"],
  ["EarningsPerShareDiluted", "USD/shares", "eps", "duration", 1],
  ["DepreciationDepletionAndAmortization", "USD", "da", "duration"],
  ["ShareBasedCompensation", "USD", "sbc", "duration"],
  ["NetCashProvidedByUsedInOperatingActivities", "USD", "cfo", "duration"],
  ["PaymentsToAcquirePropertyPlantAndEquipment", "USD", "capex", "duration"],
  ["NetCashProvidedByUsedInInvestingActivities", "USD", "cfi", "duration"],
  ["PaymentsOfDividends", "USD", "dividends", "duration"],
  ["PaymentsForRepurchaseOfCommonStock", "USD", "buybacks", "duration"],
  ["NetCashProvidedByUsedInFinancingActivities", "USD", "cff", "duration"],
  ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "USD", "netChange", "duration"],
];

const INSTANT_LINES: Line[] = [
  ["CashAndCashEquivalentsAtCarryingValue", "USD", "cash", "instant"],
  ["ShortTermInvestments", "USD", "sti", "instant"],
  ["AccountsReceivableNetCurrent", "USD", "receivables", "instant"],
  ["InventoryNet", "USD", "inventory", "instant"],
  ["AssetsCurrent", "USD", "totalCurrentAssets", "instant"],
  ["PropertyPlantAndEquipmentNet", "USD", "ppe", "instant"],
  ["Goodwill", "USD", "goodwill", "instant"],
  ["Assets", "USD", "totalAssets", "instant"],
  ["AccountsPayableCurrent", "USD", "accountsPayable", "instant"],
  ["DebtCurrent", "USD", "shortTermDebt", "instant"],
  ["LiabilitiesCurrent", "USD", "totalCurrentLiabilities", "instant"],
  ["LongTermDebtNoncurrent", "USD", "longTermDebt", "instant"],
  ["StockholdersEquity", "USD", "totalEquity", "instant"],
  ["LiabilitiesAndStockholdersEquity", "USD", "liabilitiesAndEquity", "instant"],
];

function startOf(year: number): string {
  const prevEnd = Date.parse(FISCAL_YEAR_ENDS[year - 1] ?? `${year - 1}-09-30`);
  return new Date(prevEnd + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export function buildCompanyFacts(): CompanyFacts {
  const gaap: CompanyFacts["facts"][string] = {};
  const add = (concept: string, unit: string, entry: FactEntry, label?: string) => {
    gaap[concept] ??= { label: label ?? concept.replace(/([a-z])([A-Z])/g, "$1 $2"), units: {} };
    (gaap[concept].units[unit] ??= []).push(entry);
  };

  for (let filingYear = 2019; filingYear <= 2024; filingYear++) {
    const accn = accessionFor(filingYear);
    const filed = filedDate(filingYear);
    const meta = { accn, fy: filingYear, fp: "FY", form: "10-K", filed };

    for (let year = filingYear - 2; year <= filingYear; year++) {
      if (!FISCAL_YEAR_ENDS[year]) continue;
      const restated = year === 2022 && filingYear >= 2023 ? RESTATED_FY2022_REVENUE : undefined;
      const f = figures(year, restated);
      const period = { start: startOf(year), end: FISCAL_YEAR_ENDS[year] };

      const revenueConcept =
        filingYear >= 2022 ? "RevenueFromContractWithCustomerExcludingAssessedTax" : "SalesRevenueNet";
      add(revenueConcept, "USD", { ...period, val: f.revenue * M, ...meta });

      for (const [concept, unit, key, , scale] of DURATION_LINES) {
        add(concept, unit, { ...period, val: f[key] * (scale ?? M), ...meta });
      }
    }

    // Balance sheet: this year and last year.
    for (const year of [filingYear - 1, filingYear]) {
      if (!FISCAL_YEAR_ENDS[year]) continue;
      const f = figures(year, year === 2022 && filingYear >= 2023 ? RESTATED_FY2022_REVENUE : undefined);
      for (const [concept, unit, key] of INSTANT_LINES) {
        add(concept, unit, { end: FISCAL_YEAR_ENDS[year], val: f[key] * M, ...meta });
      }
    }

    // Cash flow statement cash balances: beginning and end of each of the three years.
    for (let year = filingYear - 3; year <= filingYear; year++) {
      if (CASH[year] === undefined) continue;
      const end = FISCAL_YEAR_ENDS[year] ?? `${year}-09-30`;
      add("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "USD", {
        end, val: CASH[year] * M, ...meta,
      });
    }

    // Fourth-quarter revenue reported inside the 10-K: must be ignored.
    const q4End = FISCAL_YEAR_ENDS[filingYear];
    const q4Start = new Date(Date.parse(q4End) - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    add("OperatingIncomeLoss", "USD", { start: q4Start, end: q4End, val: 1 * M, ...meta, fp: "FY" });
  }

  // Quarterly filings: a 10-Q with a quarter and a nine-month year-to-date figure.
  add("NetIncomeLoss", "USD", {
    start: "2024-09-29", end: "2024-12-28", val: 30_000 * M,
    accn: "0001234567-25-000050", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-01-31",
  });
  add("AssetsCurrent", "USD", {
    end: "2024-12-28", val: 1 * M,
    accn: "0001234567-25-000050", fy: 2025, fp: "Q1", form: "10-Q", filed: "2025-01-31",
  });

  return {
    cik: CIK,
    entityName: "Example Corp",
    facts: {
      dei: {
        EntityCommonStockSharesOutstanding: {
          label: "Entity Common Stock, Shares Outstanding",
          units: { shares: [{ end: "2024-10-18", val: 15_200 * M, accn: accessionFor(2024), fy: 2024, fp: "FY", form: "10-K", filed: filedDate(2024) }] },
        },
      },
      "us-gaap": gaap,
    },
  };
}
