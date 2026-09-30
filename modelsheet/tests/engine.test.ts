import { describe, expect, it } from "vitest";
import { checkFormulaSyntax, evaluateWorkbook } from "@/lib/sheet/engine";
import type { Cell, Sheet } from "@/lib/sheet/types";

function sheet(name: string, cells: Record<string, Cell>): Sheet {
  return { name, title: name, rowCount: 20, colCount: 10, cells, frozenRows: 0 };
}

describe("evaluateWorkbook", () => {
  it("evaluates formulas in dependency order, whatever order cells are stored in", () => {
    const values = evaluateWorkbook({
      sheets: [
        sheet("S", {
          C1: { formula: "B1*2" },
          B1: { formula: "A1+1" },
          A1: { value: 10 },
          D1: { formula: "SUM(A1:C1)" },
        }),
      ],
    });
    expect(values["S!B1"]).toBe(11);
    expect(values["S!C1"]).toBe(22);
    expect(values["S!D1"]).toBe(43);
  });

  it("follows references across sheets", () => {
    const values = evaluateWorkbook({
      sheets: [
        sheet("Income", { B2: { value: 100 } }),
        sheet("Other", { A1: { formula: "Income!B2*3" } }),
      ],
    });
    expect(values["Other!A1"]).toBe(300);
  });

  it("supplies MAX, MIN and NPV, which the parser lacks", () => {
    const values = evaluateWorkbook({
      sheets: [
        sheet("S", {
          A1: { value: 3 },
          A2: { value: -1 },
          A3: { value: 7 },
          B1: { formula: "MAX(A1:A3)" },
          B2: { formula: "MIN(A1:A3, 0)" },
          B3: { formula: "NPV(0.1, 110, 121)" },
        }),
      ],
    });
    expect(values["S!B1"]).toBe(7);
    expect(values["S!B2"]).toBe(-1);
    expect(values["S!B3"]).toBeCloseTo(200, 9);
  });

  it("reports errors instead of throwing", () => {
    const values = evaluateWorkbook({
      sheets: [
        sheet("S", {
          A1: { value: 1 },
          B1: { formula: "A1/0" },
          B2: { formula: "B1+1" },
          B3: { formula: "Nowhere!A1" },
          B4: { formula: "1+" },
          B5: { formula: "B4*2" },
          B6: { formula: "NOTAFUNCTION(1)" },
        }),
      ],
    });
    expect(values["S!B1"]).toMatchObject({ error: "#DIV/0!" });
    expect(values["S!B2"]).toMatchObject({ error: "#DIV/0!" });
    expect(values["S!B3"]).toMatchObject({ error: "#REF!" });
    expect(values["S!B4"]).toMatchObject({ error: "#ERROR!" });
    expect(values["S!B5"]).toMatchObject({ error: "#ERROR!" });
    expect(values["S!B6"]).toMatchObject({ error: "#NAME?" });
  });

  it("marks circular references without hanging", () => {
    const values = evaluateWorkbook({
      sheets: [
        sheet("S", {
          A1: { formula: "B1+1" },
          B1: { formula: "A1+1" },
          C1: { formula: "C1" },
          D1: { value: 5 },
          E1: { formula: "D1*2" },
        }),
      ],
    });
    expect(values["S!A1"]).toMatchObject({ error: "#CIRC!" });
    expect(values["S!B1"]).toMatchObject({ error: "#CIRC!" });
    expect(values["S!C1"]).toMatchObject({ error: "#CIRC!" });
    expect(values["S!E1"]).toBe(10);
  });

  it("treats blank references as zero", () => {
    const values = evaluateWorkbook({ sheets: [sheet("S", { A1: { formula: "Z9+4" }, A2: { formula: "Z9" } })] });
    expect(values["S!A1"]).toBe(4);
    expect(values["S!A2"]).toBe(0);
  });
});

describe("checkFormulaSyntax", () => {
  it("accepts valid formulas and rejects broken ones", () => {
    expect(checkFormulaSyntax("SUM(A1:B2)*Income!C3")).toBeNull();
    expect(checkFormulaSyntax("SUM(A1:")).not.toBeNull();
  });
});
