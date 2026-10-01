import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, runAgent, type CreateMessage } from "@/lib/agent/agent";
import { base, CASES, gradeResult } from "./agent-cases";

// Runs the scripted cases in agent-cases.ts against the real Claude API.
// THIS SPENDS API CREDITS: one request per case, about 8k input tokens
// each. `npm test` never runs it; run it on purpose with:
//   ANTHROPIC_API_KEY=... npm run eval:agent

const enabled = process.env.RUN_AGENT_EVALS === "1";
const PRICE_PER_MTOK = { input: 4, output: 20 }; // claude-opus-5-5; adjust for ANTHROPIC_MODEL

describe.skipIf(!enabled)("assistant evals (spends API credits)", () => {
  const client = new Anthropic();
  const stats: Array<{ name: string; ms: number; input: number; output: number; failures: string[] }> = [];

  for (const testCase of CASES) {
    it(testCase.name, async () => {
      const before = testCase.setup ? testCase.setup(base) : base;
      let usage = { input_tokens: 0, output_tokens: 0 };
      const create: CreateMessage = async (params) => {
        const response = await client.beta.messages.create(params);
        usage = response.usage;
        return response;
      };
      const started = Date.now();
      const result = await runAgent({ workbook: before, message: testCase.message }, create);
      const ms = Date.now() - started;
      const failures = gradeResult(testCase, before, result);
      stats.push({ name: testCase.name, ms, input: usage.input_tokens, output: usage.output_tokens, failures });
      expect(failures).toEqual([]);
    });
  }

  it("summary", () => {
    const passed = stats.filter((s) => !s.failures.length).length;
    const latencies = stats.map((s) => s.ms).sort((a, b) => a - b);
    const cost = stats.reduce((sum, s) => sum + (s.input * PRICE_PER_MTOK.input + s.output * PRICE_PER_MTOK.output) / 1e6, 0);
    console.log(`\nModel: ${process.env.ANTHROPIC_MODEL || DEFAULT_MODEL}`);
    console.log(`Passed ${passed}/${stats.length}`);
    console.log(`Latency: median ${(latencies[Math.floor(latencies.length / 2)] / 1000).toFixed(1)}s, max ${(latencies.at(-1)! / 1000).toFixed(1)}s (PRD target: under 10s)`);
    console.log(`Cost: $${cost.toFixed(3)} total, $${(cost / stats.length).toFixed(4)} per request`);
    for (const s of stats) if (s.failures.length) console.log(`  ✗ ${s.name}: ${s.failures.join("; ")}`);
  });
});
