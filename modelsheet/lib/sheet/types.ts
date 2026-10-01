export type Scalar = number | string | boolean | null;

/** A formula that could not be evaluated, e.g. `#DIV/0!` or `#CIRC!`. */
export interface CellError {
  error: string;
  message?: string;
}

export type CellValue = Scalar | CellError;

export type StatementKey = "income" | "balance" | "cashflow";

/** Where a hardcoded historical number came from. */
export interface FilingSource {
  /** XBRL concept, e.g. `us-gaap:Revenues`. */
  concept: string;
  /** The taxonomy's human-readable label for the concept. */
  conceptLabel: string;
  statement: StatementKey;
  /** The line item in our standard template the value was mapped to. */
  lineItem: string;
  form: string;
  accessionNumber: string;
  filed: string;
  periodStart?: string;
  periodEnd: string;
  /** The value exactly as reported, before scaling. */
  reportedValue: number;
  unit: string;
  /** Multiplier applied to the reported value to get the cell value. */
  scale: number;
  url: string;
}

export type CellFormat = "number" | "percent" | "perShare" | "text";

export type CellRole =
  | "header"
  | "label"
  | "filing"
  | "formula"
  | "assumption"
  | "manual";

export interface Cell {
  /** Formula without the leading `=`. Mutually exclusive with `value`. */
  formula?: string;
  value?: Scalar;
  source?: FilingSource;
  /** Short explanation shown in the source panel, e.g. why a value is missing. */
  note?: string;
  role?: CellRole;
  format?: CellFormat;
  bold?: boolean;
}

export interface Sheet {
  name: string;
  title: string;
  rowCount: number;
  colCount: number;
  /** Keyed by A1 address. */
  cells: Record<string, Cell>;
  /** Rows at or above this index stay visible while scrolling. */
  frozenRows: number;
}

export interface Period {
  label: string;
  start: string;
  end: string;
  kind: "actual" | "projected";
}

export interface Company {
  cik: string;
  ticker: string;
  name: string;
}

/** Where a named line item lives, so checks can find it after edits. */
export interface LineLocation {
  sheet: string;
  row: number;
}

export interface Workbook {
  company: Company;
  createdAt: string;
  units: string;
  periods: Period[];
  sheets: Sheet[];
  lines: Record<string, LineLocation>;
}

export function isCellError(value: unknown): value is CellError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CellError).error === "string"
  );
}
