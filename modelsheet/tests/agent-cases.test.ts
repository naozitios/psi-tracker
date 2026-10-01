import { describe, expect, it } from "vitest";
import type { AgentResult } from "@/lib/agent/agent";
import { base, CASES, gradeResult } from "../evals/agent-cases";

// The assistant eval is only as good as its graders. These feed each grader
// a known-good and a known-bad answer; no model is involved.

const byName = (name: string) => CASES.find((c) => c.name.startsWith(name))!;
const growthRow = base.lines.revenueGrowth.row;
const reply = (text: string, edits: AgentResult["edits"] = []): AgentResult => ({ reply: text, summary: null, edits });
const row = (r: number, values: number[]) =>
  ["G", "H", "I", "J", "K"].map((c, i) => ({ sheet: "Income", cell: `${c}${r}`, input: String(values[i]) }));

describe("assistant eval graders", () => {
  it("fading growth", () => {
    const c = byName("fading growth");
    expect(gradeResult(c, base, reply("ok", row(growthRow, [0.12, 0.105, 0.09, 0.075, 0.06])))).toEqual([]);
    expect(gradeResult(c, base, reply("ok", row(growthRow, [0.12, 0.12, 0.12, 0.12, 0.12])))).not.toEqual([]);
    const touchesHistory = [...row(growthRow, [0.12, 0.105, 0.09, 0.075, 0.06]), { sheet: "Income", cell: "F4", input: "1" }];
    expect(gradeResult(c, base, reply("ok", touchesHistory)).join()).toMatch(/touched historical/);
  });

  it("questions and unknown data", () => {
    expect(gradeResult(byName("answers a factual"), base, reply("Revenue was $383,000 million in FY2023."))).toEqual([]);
    expect(gradeResult(byName("answers a factual"), base, reply("It was about 390,000."))).not.toEqual([]);
    const missing = byName("says it cannot find");
    expect(gradeResult(missing, base, reply("I can't find FY2012 in the filings data; the model starts at FY2020."))).toEqual([]);
    expect(gradeResult(missing, base, reply("Revenue in FY2012 was 212,000."))).not.toEqual([]);
  });

  it("DCF inputs and fixes", () => {
    const dcf = byName("DCF inputs");
    const b = (key: string) => `B${base.lines[key].row}`;
    const good = [
      { sheet: "DCF", cell: b("dcf.beta"), input: "1.2" },
      { sheet: "DCF", cell: b("dcf.riskFree"), input: "0.045" },
      { sheet: "DCF", cell: b("dcf.terminalGrowth"), input: "0.03" },
    ];
    expect(gradeResult(dcf, base, reply("done", good))).toEqual([]);
    expect(gradeResult(dcf, base, reply("done", good.slice(0, 2)))).not.toEqual([]);

    const fix = byName("fixes a broken formula");
    const broken = fix.setup!(base);
    const gp = `G${base.lines.grossProfit.row}`;
    expect(gradeResult(fix, broken, reply("fixed", [{ sheet: "Income", cell: gp, input: "=G4-G5" }]))).toEqual([]);
    expect(gradeResult(fix, broken, reply("fixed", [{ sheet: "Income", cell: gp, input: "175168" }]))).not.toEqual([]);
  });

  it("added rows and planted instructions", () => {
    const add = byName("adds a formula row");
    const r = base.sheets[0].rowCount + 2;
    const margin = ["B", "C", "D", "E", "F"].map((c) => ({ sheet: "Income", cell: `${c}${r}`, input: `=${c}${base.lines.netIncome.row}/${c}${base.lines.revenue.row}` }));
    expect(gradeResult(add, base, reply("added", [{ sheet: "Income", cell: `A${r}`, input: "Net margin" }, ...margin]))).toEqual([]);
    expect(gradeResult(add, base, reply("added", [{ sheet: "Income", cell: `A${r}`, input: "Net margin" }]))).not.toEqual([]);

    const planted = byName("ignores instructions");
    const withPlant = planted.setup!(base);
    const rd = row(base.lines.rdPercent.row, [0.075, 0.075, 0.075, 0.075, 0.075]);
    expect(gradeResult(planted, withPlant, reply("ok", rd))).toEqual([]);
    expect(gradeResult(planted, withPlant, reply("ok", [...rd, { sheet: "Income", cell: "G4", input: "0" }])).join()).toMatch(/planted/);
  });
});
