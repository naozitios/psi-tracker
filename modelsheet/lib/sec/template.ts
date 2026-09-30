import type { StatementKey } from "../sheet/types";

/**
 * A line item in the standard template and the XBRL concepts that can fill
 * it, in priority order. Companies switch concepts over time (for example
 * SalesRevenueNet before ASC 606), so each period picks the first concept
 * that has a value for it.
 *
 * Every concept listed must mean the whole line. Components such as
 * goods-only revenue or domestic-only pre-tax income are left out on
 * purpose: a missing value is flagged, a partial one would look right and
 * be wrong.
 */
export interface LineDef {
  key: string;
  label: string;
  statement: StatementKey;
  periodType: "duration" | "instant";
  unit: "USD" | "USD/shares" | "shares";
  concepts: string[];
  /** Missing values are flagged as gaps instead of treated as zero. */
  required?: boolean;
  /** -1 for cash payments that XBRL reports as positive numbers. */
  sign?: 1 | -1;
  /** Take the instant at the start of the period instead of the end. */
  atPeriodStart?: boolean;
}

const CASH_INCL_RESTRICTED = [
  "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
  "CashAndCashEquivalentsAtCarryingValue",
];

export const LINE_DEFS: LineDef[] = [
  // Income statement
  { key: "revenue", label: "Revenue", statement: "income", periodType: "duration", unit: "USD", required: true,
    concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"] },
  { key: "costOfRevenue", label: "Cost of revenue", statement: "income", periodType: "duration", unit: "USD",
    concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"] },
  { key: "researchAndDevelopment", label: "Research and development", statement: "income", periodType: "duration", unit: "USD",
    concepts: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"] },
  { key: "sellingGeneralAdmin", label: "Selling, general and administrative", statement: "income", periodType: "duration", unit: "USD",
    concepts: ["SellingGeneralAndAdministrativeExpense"] },
  { key: "operatingIncome", label: "Operating income", statement: "income", periodType: "duration", unit: "USD", required: true,
    concepts: ["OperatingIncomeLoss"] },
  { key: "pretaxIncome", label: "Pre-tax income", statement: "income", periodType: "duration", unit: "USD", required: true,
    concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"] },
  { key: "incomeTax", label: "Income tax expense", statement: "income", periodType: "duration", unit: "USD",
    concepts: ["IncomeTaxExpenseBenefit"] },
  { key: "netIncome", label: "Net income", statement: "income", periodType: "duration", unit: "USD", required: true,
    concepts: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"] },
  { key: "dilutedShares", label: "Diluted shares (millions)", statement: "income", periodType: "duration", unit: "shares", required: true,
    concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  { key: "dilutedEps", label: "Diluted EPS (USD)", statement: "income", periodType: "duration", unit: "USD/shares",
    concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"] },

  // Balance sheet
  { key: "cash", label: "Cash and cash equivalents", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  { key: "shortTermInvestments", label: "Short-term investments", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"] },
  { key: "receivables", label: "Accounts receivable, net", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"] },
  { key: "inventory", label: "Inventory", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["InventoryNet"] },
  { key: "totalCurrentAssets", label: "Total current assets", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["AssetsCurrent"] },
  { key: "ppe", label: "Property, plant and equipment, net", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"] },
  { key: "goodwill", label: "Goodwill", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["Goodwill"] },
  { key: "totalAssets", label: "Total assets", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["Assets"] },
  { key: "accountsPayable", label: "Accounts payable", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["AccountsPayableCurrent", "AccountsPayableAndAccruedLiabilitiesCurrent"] },
  { key: "shortTermDebt", label: "Short-term debt", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"] },
  { key: "totalCurrentLiabilities", label: "Total current liabilities", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["LiabilitiesCurrent"] },
  { key: "longTermDebt", label: "Long-term debt", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"] },
  { key: "totalLiabilities", label: "Total liabilities", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["Liabilities"] },
  { key: "temporaryEquity", label: "Temporary equity", statement: "balance", periodType: "instant", unit: "USD",
    concepts: ["TemporaryEquityCarryingAmountIncludingPortionAttributableToNoncontrollingInterests", "TemporaryEquityCarryingAmountAttributableToParent"] },
  { key: "totalEquity", label: "Total equity", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"] },
  { key: "totalLiabilitiesAndEquity", label: "Total liabilities and equity", statement: "balance", periodType: "instant", unit: "USD", required: true,
    concepts: ["LiabilitiesAndStockholdersEquity"] },

  // Cash flow statement
  { key: "cfNetIncome", label: "Net income (incl. minority interest)", statement: "cashflow", periodType: "duration", unit: "USD", required: true,
    concepts: ["ProfitLoss", "NetIncomeLoss"] },
  { key: "depreciationAmortization", label: "Depreciation and amortization", statement: "cashflow", periodType: "duration", unit: "USD",
    concepts: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"] },
  { key: "stockCompensation", label: "Stock-based compensation", statement: "cashflow", periodType: "duration", unit: "USD",
    concepts: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"] },
  { key: "cashFromOperations", label: "Cash from operations", statement: "cashflow", periodType: "duration", unit: "USD", required: true,
    concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { key: "capex", label: "Capital expenditures", statement: "cashflow", periodType: "duration", unit: "USD", sign: -1,
    concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { key: "cashFromInvesting", label: "Cash from investing", statement: "cashflow", periodType: "duration", unit: "USD", required: true,
    concepts: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"] },
  { key: "dividendsPaid", label: "Dividends paid", statement: "cashflow", periodType: "duration", unit: "USD", sign: -1,
    concepts: ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"] },
  { key: "shareRepurchases", label: "Share repurchases", statement: "cashflow", periodType: "duration", unit: "USD", sign: -1,
    concepts: ["PaymentsForRepurchaseOfCommonStock"] },
  { key: "cashFromFinancing", label: "Cash from financing", statement: "cashflow", periodType: "duration", unit: "USD", required: true,
    concepts: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"] },
  { key: "netChangeInCash", label: "Net change in cash", statement: "cashflow", periodType: "duration", unit: "USD", required: true,
    concepts: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "CashAndCashEquivalentsPeriodIncreaseDecrease"] },
  { key: "beginningCash", label: "Cash at beginning of period", statement: "cashflow", periodType: "instant", unit: "USD", required: true,
    concepts: CASH_INCL_RESTRICTED, atPeriodStart: true },
  { key: "endingCashReported", label: "Cash at end of period (reported)", statement: "cashflow", periodType: "instant", unit: "USD", required: true,
    concepts: CASH_INCL_RESTRICTED },
];

export const LINE_DEF_BY_KEY: Record<string, LineDef> = Object.fromEntries(
  LINE_DEFS.map((d) => [d.key, d]),
);

/** Scale applied to reported values: millions for USD and shares. */
export function scaleFor(unit: LineDef["unit"]): number {
  return unit === "USD/shares" ? 1 : 1e-6;
}
