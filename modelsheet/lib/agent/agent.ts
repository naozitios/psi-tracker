import Anthropic from "@anthropic-ai/sdk";
import { evaluateWorkbook } from "../sheet/engine";
import type { CellEdit } from "../sheet/edits";
import type { Workbook } from "../sheet/types";
import { serializeWorkbook } from "./serialize";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AgentResult {
  reply: string;
  summary: string | null;
  edits: CellEdit[];
}

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
export type CreateMessage = (params: CreateParams) => Promise<Message>;

export const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_HISTORY_TURNS = 10;
/** About 25k tokens: bounds what one request can cost, whatever the workbook holds. */
export const MAX_WORKBOOK_PROMPT_CHARS = 90_000;

export class WorkbookTooLarge extends Error {
  constructor() {
    super("This model has grown too large for the assistant. Remove unused rows and try again.");
  }
}

export const SYSTEM_PROMPT = `You are the modeling assistant inside a spreadsheet that holds a company's financial model built from its SEC 10-K filings. The user is a self-directed investor. You change the workbook only by calling propose_edits; the user sees your edits as a highlighted diff and accepts or rejects them, so nothing changes until they agree.

How the workbook is built:
- Historical cells marked [from filing] are hardcoded values extracted from the company's XBRL filings. Subtotals and "other" lines are formulas that reconcile to reported totals.
- Projections live on the Income sheet. Every projected number is a formula driven by the rows in the Drivers block (revenue growth, margins, cost ratios, tax rate). Cells marked [assumption] are the driver inputs for projected years.
- Values are in USD millions except per-share amounts. Percentages are decimals: 12% is 0.12.

Rules:
- Never invent or estimate a historical figure. If the user asks about a number that is not in the workbook, say you can't find it in the filings data instead of guessing. Only overwrite a [from filing] cell when the user gives you the exact replacement value.
- To change a forecast, edit the driver cells, not the projected line items, so the model stays formula-driven. Enter assumptions as plain numbers (0.12) unless the user wants a formula.
- Keep formulas intact. When you fix a broken formula, write the corrected formula; do not paste its result as a value.
- Use Excel formula syntax with A1 references. Refer to other sheets as SheetName!B4. Supported functions include SUM, AVERAGE, MIN, MAX, IF, IFERROR, ROUND, ABS and NPV.
- To add a row, write its label in column A of the sheet's first free row (or leave one blank spacer row) and fill the period columns. Do not insert rows between existing ones.
- Make every edit the request needs in a single propose_edits call. If the user only asks a question, answer it in text without calling the tool.
- Reply in one to three short sentences. The diff shows the details.`;

export const PROPOSE_EDITS_TOOL: Anthropic.Beta.Messages.BetaTool = {
  name: "propose_edits",
  description:
    "Propose cell edits to the workbook. The user reviews them as a diff before anything changes. Include every edit the request needs in one call.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One sentence describing the change, shown above the diff.",
      },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sheet: { type: "string", description: "Sheet name, e.g. Income." },
            cell: { type: "string", description: "A1-style address, e.g. G24." },
            input: {
              type: "string",
              description:
                "New content as typed into a spreadsheet: a formula starting with =, a number such as 0.12, or a text label. An empty string clears the cell.",
            },
            reason: { type: "string", description: "Why this cell changes, in a few words." },
          },
          required: ["sheet", "cell", "input", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "edits"],
    additionalProperties: false,
  },
};

let client: Anthropic | null = null;

const defaultCreate: CreateMessage = (params) => {
  client ??= new Anthropic();
  return client.beta.messages.create(params);
};

function buildMessages(
  workbook: Workbook,
  message: string,
  history: ChatTurn[],
): Anthropic.Beta.Messages.BetaMessageParam[] {
  const recent = history.filter((t) => t.text.trim()).slice(-MAX_HISTORY_TURNS);
  while (recent.length && recent[0].role !== "user") recent.shift();
  const sheet = serializeWorkbook(workbook, evaluateWorkbook(workbook));
  if (sheet.length > MAX_WORKBOOK_PROMPT_CHARS) throw new WorkbookTooLarge();
  return [
    ...recent.map((turn) => ({ role: turn.role, content: turn.text })),
    {
      role: "user" as const,
      content: `<workbook>\n${sheet}\n</workbook>\n\n${message}`,
    },
  ];
}

function readEdits(input: unknown): { summary: string; edits: CellEdit[] } | null {
  if (typeof input !== "object" || input === null) return null;
  const { summary, edits } = input as { summary?: unknown; edits?: unknown };
  if (typeof summary !== "string" || !Array.isArray(edits)) return null;
  const parsed: CellEdit[] = [];
  for (const e of edits) {
    if (
      typeof e?.sheet === "string" &&
      typeof e?.cell === "string" &&
      typeof e?.input === "string"
    ) {
      parsed.push({
        sheet: e.sheet,
        cell: e.cell,
        input: e.input,
        reason: typeof e.reason === "string" ? e.reason : undefined,
      });
    }
  }
  return { summary, edits: parsed };
}

/**
 * Asks Claude for edits that satisfy the user's request. Returns proposed
 * edits only; applying them is the caller's job once the user accepts.
 */
export async function runAgent(
  request: { workbook: Workbook; message: string; history?: ChatTurn[] },
  createMessage: CreateMessage = defaultCreate,
): Promise<AgentResult> {
  const messages = buildMessages(request.workbook, request.message, request.history ?? []);
  const response = await createMessage({
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: [PROPOSE_EDITS_TOOL],
    messages,
  });

  if (response.stop_reason === "refusal") {
    return { reply: "I can't help with that request.", summary: null, edits: [] };
  }
  if (response.stop_reason === "max_tokens") {
    return {
      reply: "My answer was cut off before it finished. Try asking for a smaller change.",
      summary: null,
      edits: [],
    };
  }

  const text: string[] = [];
  let proposal: { summary: string; edits: CellEdit[] } | null = null;
  for (const block of response.content) {
    if (block.type === "text") text.push(block.text);
    if (block.type === "tool_use" && block.name === PROPOSE_EDITS_TOOL.name) {
      proposal = readEdits(block.input);
    }
  }

  const reply = text.join("\n").trim() || proposal?.summary || "";
  return {
    reply: reply || "I don't have a change to suggest for that.",
    summary: proposal?.summary ?? null,
    edits: proposal?.edits ?? [],
  };
}
