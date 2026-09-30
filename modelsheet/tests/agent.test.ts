import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, runAgent, type CreateMessage } from "@/lib/agent/agent";
import { serializeWorkbook } from "@/lib/agent/serialize";
import { buildWorkbook } from "@/lib/model/build";
import { extractFinancials } from "@/lib/sec/extract";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import { buildCompanyFacts } from "./fixtures/companyfacts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const workbook = buildWorkbook(extractFinancials(buildCompanyFacts()), { ticker: "EXMP" });

function fakeMessage(content: unknown[], stop_reason: string = "end_turn"): Message {
  return { id: "msg_1", type: "message", role: "assistant", model: DEFAULT_MODEL, content, stop_reason } as unknown as Message;
}

function recorder(response: Message): { create: CreateMessage; calls: Params[] } {
  const calls: Params[] = [];
  return {
    calls,
    create: async (params) => {
      calls.push(params);
      return response;
    },
  };
}

describe("runAgent", () => {
  it("returns the edits Claude proposes through the tool", async () => {
    const { create, calls } = recorder(
      fakeMessage(
        [
          { type: "text", text: "I set revenue growth to fade from 12% to 6%." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "propose_edits",
            input: {
              summary: "Revenue growth fades from 12% to 6%",
              edits: [{ sheet: "Income", cell: "G21", input: "0.12", reason: "Year 1 growth" }],
            },
          },
        ],
        "tool_use",
      ),
    );

    const result = await runAgent(
      {
        workbook,
        message: "Project revenue growth at 12% fading to 6%",
        history: [
          { role: "assistant", text: "orphan reply is dropped" },
          { role: "user", text: "hi" },
          { role: "assistant", text: "hello" },
        ],
      },
      create,
    );

    expect(result).toEqual({
      reply: "I set revenue growth to fade from 12% to 6%.",
      summary: "Revenue growth fades from 12% to 6%",
      edits: [{ sheet: "Income", cell: "G21", input: "0.12", reason: "Year 1 growth" }],
    });

    const params = calls[0];
    expect(params.model).toBe(DEFAULT_MODEL);
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.tools?.[0]).toMatchObject({ name: "propose_edits", strict: true });
    expect(params.tool_choice).toBeUndefined();
    expect(params.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const last = params.messages[2].content as string;
    expect(last).toContain("<workbook>");
    expect(last).toMatch(/Project revenue growth at 12% fading to 6%$/);
  });

  it("answers questions without edits", async () => {
    const { create } = recorder(fakeMessage([{ type: "text", text: "Operating margin was 26%." }]));
    const result = await runAgent({ workbook, message: "What was operating margin?" }, create);
    expect(result).toEqual({ reply: "Operating margin was 26%.", summary: null, edits: [] });
  });

  it("does not act on a refusal or a truncated response", async () => {
    const refused = await runAgent({ workbook, message: "x" }, recorder(fakeMessage([], "refusal")).create);
    expect(refused.edits).toEqual([]);
    expect(refused.reply).toMatch(/can't help/);

    const truncated = await runAgent(
      { workbook, message: "x" },
      recorder(
        fakeMessage(
          [{ type: "tool_use", id: "t", name: "propose_edits", input: { summary: "s", edits: [{ sheet: "Income", cell: "G21", input: "0.1", reason: "r" }] } }],
          "max_tokens",
        ),
      ).create,
    );
    expect(truncated.edits).toEqual([]);
  });
});

describe("serializeWorkbook", () => {
  it("shows formulas, values and where inputs came from", () => {
    const text = serializeWorkbook(workbook, evaluateWorkbook(workbook));
    const revenueRow = workbook.lines.revenue.row;
    expect(text).toContain("Example Corp (EXMP)");
    expect(text).toContain(`Row ${revenueRow}: "Revenue" | B${revenueRow}=274000.0 [from filing]`);
    expect(text).toMatch(new RegExp(`G${revenueRow}: =F${revenueRow}\\*\\(1\\+G\\d+\\) → \\d+\\.\\d`));
    expect(text).toMatch(/\[assumption\]/);
    expect(text).toContain("## Sheet BalanceSheet (Balance sheet)");
  });
});
