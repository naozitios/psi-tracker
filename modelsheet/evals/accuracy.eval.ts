import { writeFileSync, mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connectPglite, migrate } from "@/lib/db";
import { buildWorkbook } from "@/lib/model/build";
import { runChecks } from "@/lib/model/checks";
import { HOUR, padCik, secFetchJson } from "@/lib/sec/client";
import { extractFinancials, matchesPeriod, pickValue, type CompanyFacts } from "@/lib/sec/extract";
import { loadCompanyProfile } from "@/lib/sec/submissions";
import { LINE_DEFS } from "@/lib/sec/template";
import { loadTickers } from "@/lib/sec/tickers";
import { cellKey, colToLetters } from "@/lib/sheet/address";
import { evaluateWorkbook } from "@/lib/sheet/engine";

// The PRD's accuracy gate: build models for 50 large US companies from live
// SEC data and measure them. Uses SEC EDGAR only, no API credits.
//   SEC_USER_AGENT="Name you@example.com" npm run eval:accuracy
// Set ACCURACY_TICKERS=AAPL,MSFT to run a subset.

const enabled = process.env.RUN_ACCURACY_EVAL === "1";

// A proposed answer to the PRD's open question "which 50 companies": large
// US non-financials across sectors, including odd fiscal years (NVDA, WMT,
// COST, ORCL, CSCO, NKE, HD) and heavy restaters.
const DEFAULT_TICKERS = (
  "AAPL MSFT GOOGL AMZN META NVDA TSLA ORCL ADBE CRM CSCO INTC AMD QCOM TXN IBM NFLX DIS CMCSA T " +
  "VZ WMT COST HD LOW TGT NKE SBUX MCD KO PEP PG CL KMB JNJ PFE MRK ABBV LLY TMO CVS XOM CVX COP " +
  "CAT DE BA GE HON UPS"
).split(" ");

const GATE = Number(process.env.ACCURACY_GATE ?? 0.98);

const TOLERANCE = 0.005; // PRD F2: within 0.5%

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.abs(b) * TOLERANCE + 1e-9;
}

interface CompanyResult {
  ticker: string;
  status: "ok" | "skipped" | "error";
  note?: string;
  coverage?: { present: number; required: number };
  /** Gross profit formula vs the company's reported GrossProfit, where filed. */
  reconciled?: { within: number; compared: number };
  /** Line-years where another candidate concept disagrees with the one used. */
  conflicts?: string[];
  failing?: string[];
}

describe.skipIf(!enabled)("extraction accuracy on live SEC data", () => {
  it("meets the PRD's 98% gate", async () => {
    const db = await connectPglite();
    await migrate(db);
    const tickers = process.env.ACCURACY_TICKERS?.split(",").map((t) => t.trim().toUpperCase()) ?? DEFAULT_TICKERS;
    const directory = await loadTickers(db);
    const results: CompanyResult[] = [];

    for (const ticker of tickers) {
      const entry = directory.find((e) => e.ticker === ticker);
      if (!entry) {
        results.push({ ticker, status: "error", note: "ticker not in SEC list" });
        continue;
      }
      try {
        const profile = await loadCompanyProfile(db, entry.cik);
        if (!profile.supported) {
          results.push({ ticker, status: "skipped", note: profile.unsupportedReason });
          continue;
        }
        const facts = await secFetchJson<CompanyFacts>(
          db,
          `https://data.sec.gov/api/xbrl/companyfacts/CIK${padCik(entry.cik)}.json`,
          24 * HOUR,
        );
        const extraction = extractFinancials(facts);
        const wb = buildWorkbook(extraction, { ticker });
        const values = evaluateWorkbook(wb);

        let present = 0;
        let required = 0;
        for (const def of LINE_DEFS.filter((d) => d.required)) {
          for (const v of extraction.lines[def.key]) {
            required++;
            if (v) present++;
          }
        }

        // Gross profit is a formula in the model (revenue minus cost of
        // revenue), so the company's own reported figure checks both inputs.
        let within = 0;
        let compared = 0;
        const grossDef = { ...LINE_DEFS.find((d) => d.key === "revenue")!, concepts: ["GrossProfit"] };
        extraction.periods.forEach((period, i) => {
          const reported = pickValue(facts, grossDef, (e) => matchesPeriod(e, grossDef, period));
          const loc = wb.lines.grossProfit;
          const modelValue = values[cellKey(loc.sheet, `${colToLetters(2 + i)}${loc.row}`)];
          if (!reported || typeof modelValue !== "number") return;
          compared++;
          if (close(modelValue, reported.value)) within++;
        });

        // Where a company files several candidate concepts for one line, they
        // should agree; disagreement means a concept is partial or mislabelled.
        const conflicts: string[] = [];
        for (const def of LINE_DEFS) {
          extraction.periods.forEach((period, i) => {
            const used = extraction.lines[def.key][i];
            if (!used) return;
            for (const concept of def.concepts) {
              if (`us-gaap:${concept}` === used.source.concept) continue;
              const single = { ...def, concepts: [concept] };
              const other = pickValue(facts, single, (e) => matchesPeriod(e, single, period));
              if (other && !close(other.value, used.value)) {
                conflicts.push(`${def.label} ${period.label}: ${used.source.concept} vs ${concept}`);
              }
            }
          });
        }

        const failing = runChecks(wb, values).filter((c) => c.status === "fail").map((c) => c.label);
        results.push({ ticker, status: "ok", coverage: { present, required }, reconciled: { within, compared }, conflicts, failing });
      } catch (err) {
        results.push({ ticker, status: "error", note: (err as Error).message });
      }
    }
    await db.close();

    const ok = results.filter((r) => r.status === "ok");
    const present = ok.reduce((s, r) => s + r.coverage!.present, 0);
    const required = ok.reduce((s, r) => s + r.coverage!.required, 0);
    const within = ok.reduce((s, r) => s + r.reconciled!.within, 0);
    const compared = ok.reduce((s, r) => s + r.reconciled!.compared, 0);
    const clean = ok.filter((r) => !r.failing!.length).length;

    const lines = [
      `# Extraction accuracy, ${new Date().toISOString().slice(0, 10)}`,
      "",
      `- Companies built: ${ok.length} of ${results.length} (skipped ${results.filter((r) => r.status === "skipped").length}, errors ${results.filter((r) => r.status === "error").length})`,
      `- Required line items present: ${present}/${required} (${((100 * present) / Math.max(1, required)).toFixed(1)}%)`,
      `- Gross profit within 0.5% of the company's reported figure: ${within}/${compared}`,
      `- Line-years where candidate concepts disagree: ${ok.reduce((s, r) => s + r.conflicts!.length, 0)} (see report)`,
      `- Models with every check passing: ${clean}/${ok.length}`,
      "",
      "| Ticker | Status | Required lines present | Gross profit reconciled | Concept conflicts | Failing checks / note |",
      "|---|---|---|---|---|---|",
      ...results.map((r) =>
        r.status === "ok"
          ? `| ${r.ticker} | ok | ${r.coverage!.present}/${r.coverage!.required} | ${r.reconciled!.within}/${r.reconciled!.compared} | ${r.conflicts!.join("; ") || "-"} | ${r.failing!.join(", ") || "-"} |`
          : `| ${r.ticker} | ${r.status} | | | | ${r.note ?? ""} |`,
      ),
    ];
    mkdirSync("evals/results", { recursive: true });
    const file = `evals/results/accuracy-${new Date().toISOString().slice(0, 10)}.md`;
    writeFileSync(file, lines.join("\n") + "\n");
    console.log(lines.slice(0, 8).join("\n") + `\n\nFull report: ${file}`);

    expect(present / Math.max(1, required)).toBeGreaterThanOrEqual(GATE);
    expect(clean / Math.max(1, ok.length)).toBeGreaterThanOrEqual(GATE);
  });
});
