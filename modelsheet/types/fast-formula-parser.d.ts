// Minimal typings for the parts of fast-formula-parser this app uses. The
// package is CommonJS and attaches its helpers to the default export, so
// they are typed as static members rather than named exports.
declare module "fast-formula-parser" {
  interface CellRef {
    sheet: string;
    row: number;
    col: number;
  }
  interface RangeRef {
    sheet: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }
  type Ref = CellRef | RangeRef;

  class FormulaError {
    constructor(error: string, msg?: string, details?: unknown);
    readonly error: string;
    readonly message: string;
    static readonly DIV0: FormulaError;
    static readonly NA: FormulaError;
    static readonly NAME: FormulaError;
    static readonly NUM: FormulaError;
    static readonly REF: FormulaError;
    static readonly VALUE: FormulaError;
  }

  class DepParser {
    constructor(config?: { onVariable?: ParserConfig["onVariable"] });
    parse(formula: string, position: CellRef): Ref[];
  }

  interface ParserConfig {
    functions?: Record<string, (...args: any[]) => unknown>;
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown[][];
    onVariable?: (name: string, sheetName: string) => Ref | null;
  }

  class FormulaParser {
    constructor(config?: ParserConfig);
    parse(formula: string, position: CellRef, allowReturnArray?: boolean): unknown;
    static FormulaError: typeof FormulaError;
    static DepParser: typeof DepParser;
    static Types: { NUMBER: number; ARRAY: number; [key: string]: number };
    static FormulaHelpers: {
      flattenParams(
        params: unknown[],
        valueType: number | null,
        allowUnion: boolean,
        hook: (item: unknown, info: { isLiteral: boolean }) => void,
        defValue?: unknown,
        minSize?: number,
      ): void;
      accept(param: unknown, type?: number | null, defValue?: unknown): unknown;
    };
  }

  export = FormulaParser;
}
