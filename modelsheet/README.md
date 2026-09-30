# ModelSheet

An AI spreadsheet for self-directed investors. Type a ticker and get a five-year, three-statement model built from the company's SEC 10-K filings. Every historical number links to the filing it came from. You can edit the model in plain English, and each change shows up as a diff you accept or reject. Export to Excel keeps the formulas live.

This is the first slice of the *MVP PRD: Subset-Style AI Financial Research Platform*. It covers the five Must-have features:

| PRD feature | Where it lives |
|---|---|
| 1. Ticker-to-model (F1, F2) | `lib/sec/tickers.ts`, `lib/sec/extract.ts`, `lib/model/build.ts` |
| 2. Spreadsheet canvas with a formula engine (F3) | `lib/sheet/engine.ts`, `components/SheetGrid.tsx` |
| 3. AI chat agent, edits as diffs (F5) | `lib/agent/agent.ts`, `app/api/agent/route.ts`, `components/ChatPanel.tsx` |
| 4. Source tracing (F6) | `FilingSource` on each input cell, `components/CellInspector.tsx` |
| 5. Excel export (F7) | `lib/export/xlsx.ts`, `app/api/export/route.ts` |
| Integrity checks (F4) | `lib/model/checks.ts`, run after every edit; failing checks block export |

## Running it

```bash
cp .env.example .env.local   # set SEC_USER_AGENT and ANTHROPIC_API_KEY
npm install
npm run dev                  # http://localhost:3000
```

`SEC_USER_AGENT` is required because SEC's [fair-access policy](https://www.sec.gov/os/accessing-edgar-data) asks every client to identify itself with a name and contact email. The chat agent uses `claude-opus-5-5` by default. Set `ANTHROPIC_MODEL` to use a different model.

```bash
npm test          # unit tests (no network needed)
npm run typecheck
npm run build
```

## How a model is built

1. **Resolve the company.** Tickers and names are matched against SEC's `company_tickers.json`. The company's submissions list supplies the 10-K filings shown for confirmation. Banks and insurers are turned away because they need different templates (a PRD non-goal).
2. **Extract.** The app reads SEC's XBRL `companyfacts` API. It picks the five most recent fiscal years from full-year 10-K facts, ignoring quarterly data. It then maps each line item to a standard template (`lib/sec/template.ts`) using a priority list of `us-gaap` concepts. When several filings report the same period, the most recently filed value wins, so restatements replace the original figures.
3. **Build.** Reported totals are hardcoded inputs, each with its source. Lines such as "Other current assets" are formulas that reconcile to those totals, so the model always matches what the company reported. A required value that is missing is left blank and flagged, never estimated.
4. **Project.** The income statement has five projected years. Every projected cell is a formula driven by the *Drivers* block (revenue growth, margins, cost ratios, tax rate). Each driver starts at the average of the last three actual years.

## How the agent edits

The server sends Claude the workbook as text: each cell's formula, its value and where it came from. The server gives Claude one tool, `propose_edits` (strict schema), and applies nothing itself. Instead it validates the proposed edits, recalculates a copy of the workbook, and reruns the checks. The browser then shows the result as a preview: edited cells are outlined and recalculated cells are shaded. Accepted changes go into a change log with undo.

The system prompt forbids inventing historical figures ("say you can't find it rather than guess"). It also steers forecast changes into the driver cells so the model stays formula-driven.

## Formula engine

Formulas are evaluated by [fast-formula-parser](https://github.com/LesterLyu/fast-formula-parser) (MIT), in dependency order, with circular-reference detection. `MAX`, `MIN` and `NPV` are missing from that library and are supplied in `lib/sheet/engine.ts`. HyperFormula was ruled out because its licence is GPLv3 or commercial, and the PRD asks for a licence that allows commercial use.

## Not in this slice yet

- Persistence and share links (models live in the browser tab; refreshing loses them)
- Recent quarters, balance sheet and cash flow projections, the DCF template, and roll-forward (PRD Should-haves)
- Inserting rows between existing rows (the agent appends rows at the bottom instead)
- Sign-in and the 50-company accuracy test set

Not investment advice.
