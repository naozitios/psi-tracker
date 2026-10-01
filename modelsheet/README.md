# ModelSheet

An AI spreadsheet for self-directed investors. Type a ticker and get a company model built from its SEC filings:
- five years of income statement, balance sheet and cash flow
- a five-year forecast
- a DCF valuation
- the most recent quarters

Every historical number links to the filing it came from. You can edit the model in plain English, and each change shows up as a diff you accept or reject. Export to Excel keeps the formulas live.

This implements the *MVP PRD: Subset-Style AI Financial Research Platform*.

| PRD item | Status | Where |
|---|---|---|
| 1. Ticker-to-model (5 years plus recent quarters) | Done | `lib/sec/`, `lib/model/build.ts`, `lib/model/quarterly.ts` |
| 2. Spreadsheet canvas with formula engine | Done | `lib/sheet/engine.ts`, `components/SheetGrid.tsx` |
| 3. AI chat agent, edits as diffs | Done | `lib/agent/`, `app/api/models/[id]/agent` |
| 4. Source tracing | Done | `FilingSource` on each input, `components/CellInspector.tsx` |
| 5. Excel export | Done | `lib/export/xlsx.ts` |
| 6. DCF template (Should) | Done | `lib/model/dcf.ts` |
| 7. Roll-forward (Should) | Not yet | |
| F4 integrity checks | Done, block export on failure | `lib/model/checks.ts` |

## Running it

```bash
cp .env.example .env.local   # set SEC_USER_AGENT; ANTHROPIC_API_KEY for the assistant
npm install
npm run dev                  # http://localhost:3000
```

Local development needs no database server: without `DATABASE_URL` the app runs an in-process Postgres ([PGlite](https://pglite.dev)) stored in `.data/`.

In production, set these three:
- `DATABASE_URL`: any Postgres 14+.
- `SESSION_SECRET`: 32+ random characters.
- `SEC_USER_AGENT`: SEC's [fair-access policy](https://www.sec.gov/os/accessing-edgar-data) requires a name and contact email.

The server refuses to start without them. Migrations run automatically on first request.

```bash
npm test               # unit and API tests; no network, no API credits
npm run typecheck
npm run build
npm run metrics        # PRD success metrics from the events table
npm run eval:accuracy  # 50-company extraction test on live SEC data (free, needs network)
npm run eval:agent     # scripted assistant test (SPENDS API CREDITS, ~10 requests)
```

## Costs

Only the chat assistant costs money. It calls the Claude API, billed per token to the Anthropic Console account of `ANTHROPIC_API_KEY` (not a Claude.ai plan).
- **Per request:** the workbook sent to the model is about 8k tokens, so a request costs a few cents on the default `claude-opus-5-5`. Set `ANTHROPIC_MODEL=claude-sonnet-5-5` to roughly halve that. The prompt is hard-capped at about 25k tokens.
- **Per user:** 20 assistant requests an hour and 60 a day.
- **Whole app:** 500 a day, which bounds daily spend. All three limits can be changed with `AGENT_LIMIT_*`.
- **Everything else is free:** building models, checks, export and SEC data.

## How it works

**Building a model.**
1. The company is resolved from SEC's ticker list and its filings index. Banks and insurers are turned away (a PRD non-goal).
2. Figures come from SEC's XBRL `companyfacts`, using full-year 10-K facts for annual periods and 10-Q facts for quarters.
3. Each line item maps to a priority list of `us-gaap` concepts (`lib/sec/template.ts`), and only concepts that mean the whole line. When several filings report a period, the latest filing wins, so restatements are used.

**What's hardcoded and what's a formula.**
- **Inputs:** reported totals are hardcoded, each with its source.
- **"Other" lines:** these are formulas that reconcile to the reported totals.
- **Fourth quarters:** full year minus Q1–Q3.
- **Quarterly cash flow:** differences of the 10-Q year-to-date figures.
- **Missing values:** these are left blank and flagged, never estimated. A missing figure that the forecast depends on blocks export.

**The server owns every model.** Browsers send single-cell edits, never whole workbooks. Each edit is validated, versioned (a stale version gets a 409) and logged, so it can be undone.

**The assistant.** It gets the saved workbook as text and a strict `propose_edits` tool. Its suggestions are stored as proposals with a recalculated preview, and nothing changes until the user accepts. Its instructions forbid inventing historical figures and steer forecast changes into the driver cells.

**Sessions.** Anyone can build a model before signing in (a PRD open question). A signed, httpOnly guest cookie ties models, limits and metrics to a user.

**Shared state.** Rate limits and the SEC response cache live in Postgres, so they hold across server instances. SEC's 10 requests/second budget is counted there too.

## Formula engine

Formulas are evaluated by [fast-formula-parser](https://github.com/LesterLyu/fast-formula-parser) (MIT), in dependency order, with circular-reference detection. `MAX`, `MIN` and `NPV` are added in `lib/sheet/engine.ts`. HyperFormula was ruled out because it is GPLv3 or commercial, and the PRD asks for a licence that allows commercial use.

## Not done yet

- **Accuracy gate:** `npm run eval:accuracy` has not been run, because the sandbox this was built in cannot reach SEC. Run it before a beta; the PRD gate is 98%.
- **Assistant eval:** `npm run eval:agent` has not been run (it spends API credits). Its graders are unit-tested.
- **Sign-in:** there are guest sessions only, so clearing cookies loses access to your models. Email sign-in that claims a guest session is the next step.
- **Other gaps:**
  - roll-forward
  - share links
  - inserting rows between existing rows (the assistant appends at the bottom)
  - error monitoring
  - terms and privacy pages

Not investment advice.
