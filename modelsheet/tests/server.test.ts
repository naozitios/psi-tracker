import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectPglite, migrate, setDb, type Db } from "@/lib/db";
import { hit } from "@/lib/server/ratelimit";
import { signSession, verifySession } from "@/lib/server/session";
import type { ModelState } from "@/lib/models/types";
import { buildCompanyFacts } from "./fixtures/companyfacts";

// Route handlers run for real against an in-memory Postgres. SEC and the
// Claude API are faked at the fetch layer, so nothing leaves the process
// and no API credits are used.

const facts = buildCompanyFacts();
const submissions = {
  cik: "1234567",
  name: "Example Corp",
  tickers: ["EXMP"],
  sic: "3571",
  sicDescription: "Electronic Computers",
  fiscalYearEnd: "0928",
  filings: {
    recent: {
      accessionNumber: ["0001234567-25-000100"],
      form: ["10-K"],
      filingDate: ["2024-11-02"],
      reportDate: ["2024-09-28"],
    },
  },
};

const claudeRequests: Array<{ model: string; messages: Array<{ content: unknown }> }> = [];
const secRequests: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://www.sec.gov/") || url.startsWith("https://data.sec.gov/")) secRequests.push(url);
  if (url === "https://www.sec.gov/files/company_tickers.json") {
    return json({ 0: { cik_str: 1234567, ticker: "EXMP", title: "Example Corp" } });
  }
  if (url.startsWith("https://data.sec.gov/submissions/CIK0001234567")) return json(submissions);
  if (url.startsWith("https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567")) return json(facts);
  if (url.startsWith("https://api.anthropic.com/v1/messages")) {
    const body = JSON.parse(String(init?.body));
    claudeRequests.push(body);
    const text = String(body.messages.at(-1).content);
    const growthRow = /Row (\d+): "Revenue growth"/.exec(text)![1];
    return json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: body.model,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        { type: "text", text: "Growth now fades from 12% to 6%." },
        {
          type: "tool_use",
          id: "toolu_test",
          name: "propose_edits",
          input: {
            summary: "Revenue growth fades from 12% to 6%",
            edits: ["G", "H", "I", "J", "K"].map((c, i) => ({
              sheet: "Income",
              cell: `${c}${growthRow}`,
              input: String(+(0.12 - 0.015 * i).toFixed(3)),
              reason: `Year ${i + 1}`,
            })),
          },
        },
      ],
    });
  }
  throw new Error(`Unexpected network request in tests: ${url}`);
}

let db: Db;

beforeAll(async () => {
  db = await connectPglite();
  await migrate(db);
  setDb(db);
  process.env.SEC_USER_AGENT = "ModelSheet tests test@example.com";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  vi.stubGlobal("fetch", fakeFetch);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  setDb(null);
  await db.close();
});

const models = () => import("@/app/api/models/route");
const model = () => import("@/app/api/models/[id]/route");
const edits = () => import("@/app/api/models/[id]/edits/route");
const undo = () => import("@/app/api/models/[id]/undo/route");
const agent = () => import("@/app/api/models/[id]/agent/route");
const proposals = () => import("@/app/api/models/[id]/proposals/[proposalId]/route");
const exporter = () => import("@/app/api/models/[id]/export/route");

function req(path: string, options: { method?: string; body?: unknown; cookie?: string; raw?: string } = {}) {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
  if (options.cookie) headers.set("cookie", options.cookie);
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body) headers.set("content-type", "application/json");
  return new Request(`http://localhost${path}`, { method: options.method ?? (body ? "POST" : "GET"), headers, body });
}

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function createModel(): Promise<{ id: string; cookie: string }> {
  const res = await (await models()).POST(req("/api/models", { body: { cik: "1234567", ticker: "EXMP" } }));
  expect(res.status).toBe(201);
  const setCookie = res.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/^ms_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  return { id: ((await res.json()) as { id: string }).id, cookie: setCookie.split(";")[0] };
}

async function state(res: Response): Promise<ModelState> {
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ModelState;
}

describe("sessions", () => {
  it("accepts only tokens it signed", () => {
    const token = signSession("123e4567-e89b-42d3-a456-426614174000");
    expect(verifySession(token)).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(verifySession("123e4567-e89b-42d3-a456-426614174001" + token.slice(36))).toBeNull();
    expect(verifySession("garbage")).toBeNull();
  });
});

describe("models API", () => {
  it("builds, saves and lists a model for the caller only", async () => {
    const { id, cookie } = await createModel();
    const list = await (await models()).GET(req("/api/models", { cookie }));
    expect(((await list.json()) as { models: Array<{ id: string; ticker: string }> }).models).toEqual([
      expect.objectContaining({ id, ticker: "EXMP" }),
    ]);

    const loaded = await state(await (await model()).GET(req(`/api/models/${id}`, { cookie }), ctx({ id })));
    expect(loaded.version).toBe(1);
    expect(loaded.workbook.company.name).toBe("Example Corp");

    const stranger = await createModel();
    const res = await (await model()).GET(req(`/api/models/${id}`, { cookie: stranger.cookie }), ctx({ id }));
    expect(res.status).toBe(404);
    expect((await (await model()).GET(req(`/api/models/${id}`), ctx({ id }))).status).toBe(404);
    const anonymousList = await (await models()).GET(req("/api/models"));
    expect(await anonymousList.json()).toEqual({ models: [] });
  });

  it("fetches each SEC resource once and reuses the shared cache", async () => {
    const before = secRequests.length;
    await createModel();
    expect(secRequests.length).toBe(before);
  });

  it("saves versioned edits and rejects stale or invalid ones", async () => {
    const { id, cookie } = await createModel();
    const e = await edits();
    const saved = await state(
      await e.POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 1, edits: [{ sheet: "Income", cell: "G21", input: "0.2" }] } }), ctx({ id })),
    );
    expect(saved.version).toBe(2);
    expect(saved.workbook.sheets[0].cells.G21.value).toBe(0.2);
    expect(saved.log).toEqual([expect.objectContaining({ author: "you", summary: "Edited Income!G21" })]);

    const stale = await e.POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 1, edits: [{ sheet: "Income", cell: "G21", input: "0.3" }] } }), ctx({ id }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ version: 2 });

    const broken = await e.POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 2, edits: [{ sheet: "Income", cell: "G21", input: "=SUM(" }] } }), ctx({ id }));
    expect(broken.status).toBe(400);

    const malformed = await e.POST(req(`/api/models/${id}/edits`, { cookie, raw: '{"baseVersion": "x"' }), ctx({ id }));
    expect(malformed.status).toBe(400);
    const wrongShape = await e.POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 2, edits: "nope" } }), ctx({ id }));
    expect(wrongShape.status).toBe(400);
    const huge = await e.POST(req(`/api/models/${id}/edits`, { cookie, raw: JSON.stringify({ baseVersion: 2, edits: [], pad: "x".repeat(70_000) }) }), ctx({ id }));
    expect(huge.status).toBe(413);

    const undone = await state(await (await undo()).POST(req(`/api/models/${id}/undo`, { cookie, body: { baseVersion: 2 } }), ctx({ id })));
    expect(undone.version).toBe(3);
    expect(undone.workbook.sheets[0].cells.G21.formula).toMatch(/^AVERAGE/);
    expect(undone.log).toEqual([]);
  });
});

describe("assistant flow", () => {
  it("stores a suggestion as a preview and applies it only when accepted", async () => {
    const { id, cookie } = await createModel();
    const calls = claudeRequests.length;
    const asked = await state(
      await (await agent()).POST(req(`/api/models/${id}/agent`, { cookie, body: { message: "Fade growth from 12% to 6%" } }), ctx({ id })),
    );
    expect(claudeRequests.length).toBe(calls + 1);
    expect(claudeRequests.at(-1)!.model).toBe("claude-opus-5-5");

    expect(asked.version).toBe(1);
    expect(asked.proposal).toMatchObject({ summary: "Revenue growth fades from 12% to 6%" });
    expect(asked.proposal!.edits).toHaveLength(5);
    expect(asked.proposal!.affected.length).toBeGreaterThan(20);
    expect(asked.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(asked.workbook.sheets[0].cells.G21.formula).toMatch(/^AVERAGE/);

    const again = await (await agent()).POST(req(`/api/models/${id}/agent`, { cookie, body: { message: "more" } }), ctx({ id }));
    expect(again.status).toBe(409);

    const pid = asked.proposal!.id;
    const accepted = await state(
      await (await proposals()).POST(req(`/api/models/${id}/proposals/${pid}`, { cookie, body: { decision: "accept" } }), ctx({ id, proposalId: pid })),
    );
    expect(accepted.version).toBe(2);
    expect(accepted.proposal).toBeNull();
    expect(accepted.workbook.sheets[0].cells.G21.value).toBe(0.12);
    expect(accepted.log).toEqual([expect.objectContaining({ author: "assistant", summary: "Revenue growth fades from 12% to 6%" })]);

    const twice = await (await proposals()).POST(req(`/api/models/${id}/proposals/${pid}`, { cookie, body: { decision: "accept" } }), ctx({ id, proposalId: pid }));
    expect(twice.status).toBe(400);
  });

  it("drops a suggestion when the user edits before deciding", async () => {
    const { id, cookie } = await createModel();
    const asked = await state(await (await agent()).POST(req(`/api/models/${id}/agent`, { cookie, body: { message: "fade growth" } }), ctx({ id })));
    await state(
      await (await edits()).POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 1, edits: [{ sheet: "Income", cell: "A40", input: "note" }] } }), ctx({ id })),
    );
    const pid = asked.proposal!.id;
    const res = await (await proposals()).POST(req(`/api/models/${id}/proposals/${pid}`, { cookie, body: { decision: "accept" } }), ctx({ id, proposalId: pid }));
    expect(res.status).toBe(400);
  });
});

describe("export", () => {
  it("downloads a clean model and refuses a broken one", async () => {
    const { id, cookie } = await createModel();
    const ok = await (await exporter()).GET(req(`/api/models/${id}/export`, { cookie }), ctx({ id }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toMatch(/spreadsheetml/);
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(10_000);

    await state(
      await (await edits()).POST(req(`/api/models/${id}/edits`, { cookie, body: { baseVersion: 1, edits: [{ sheet: "BalanceSheet", cell: "F13", input: "1" }] } }), ctx({ id })),
    );
    const blocked = await (await exporter()).GET(req(`/api/models/${id}/export`, { cookie }), ctx({ id }));
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ checks: expect.arrayContaining([expect.objectContaining({ id: "balance" })]) });

    const [counts] = await db.query<{ built: string; exported: string; blocked: string }>(
      `SELECT count(*) FILTER (WHERE name = 'model_built')::text AS built,
              count(*) FILTER (WHERE name = 'export_downloaded' AND model_id = $1)::text AS exported,
              count(*) FILTER (WHERE name = 'export_blocked' AND model_id = $1)::text AS blocked
       FROM events`,
      [id],
    );
    expect(Number(counts.built)).toBeGreaterThan(0);
    expect(counts).toMatchObject({ exported: "1", blocked: "1" });
  });
});

describe("rate limits", () => {
  it("counts hits per window and key", async () => {
    expect((await hit(db, "test-key", 2, 60)).ok).toBe(true);
    expect((await hit(db, "test-key", 2, 60)).ok).toBe(true);
    const third = await hit(db, "test-key", 2, 60);
    expect(third.ok).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    expect((await hit(db, "other-key", 2, 60)).ok).toBe(true);
  });
});
