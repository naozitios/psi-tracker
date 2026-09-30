// Prints the PRD's success metrics from the events table.
//   DATABASE_URL=postgres://... npm run metrics
// Without DATABASE_URL it reads the local development database.

import { pathToFileURL } from "node:url";

const SQL = {
  buildersTotal: `SELECT count(DISTINCT user_id)::int AS n FROM events WHERE name = 'model_built'`,
  buildersLast8Weeks: `SELECT count(DISTINCT user_id)::int AS n FROM events
    WHERE name = 'model_built' AND created_at > now() - interval '56 days'`,
  // Of users whose first model is at least 14 days old, the share who built
  // a second model within 14 days of the first.
  weekTwoReturn: `
    WITH firsts AS (
      SELECT user_id, min(created_at) AS first_at FROM events
      WHERE name = 'model_built' GROUP BY user_id
    ), eligible AS (
      SELECT * FROM firsts WHERE first_at < now() - interval '14 days'
    )
    SELECT count(*)::int AS eligible,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM events e WHERE e.user_id = eligible.user_id AND e.name = 'model_built'
          AND e.created_at > eligible.first_at AND e.created_at <= eligible.first_at + interval '14 days'
      ))::int AS returned
    FROM eligible`,
  exportShare: `
    SELECT count(DISTINCT b.model_id)::int AS models,
      count(DISTINCT x.model_id)::int AS exported
    FROM events b LEFT JOIN events x ON x.model_id = b.model_id AND x.name = 'export_downloaded'
    WHERE b.name = 'model_built'`,
  medianBuildSeconds: `
    WITH firsts AS (
      SELECT DISTINCT ON (user_id) (props->>'ms')::numeric AS ms FROM events
      WHERE name = 'model_built' ORDER BY user_id, created_at
    )
    SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) / 1000)::numeric, 1)::float AS seconds FROM firsts`,
  assistant: `
    SELECT count(*) FILTER (WHERE name = 'proposal_created')::int AS proposed,
      count(*) FILTER (WHERE name = 'proposal_accepted')::int AS accepted,
      count(*) FILTER (WHERE name = 'proposal_rejected')::int AS rejected,
      count(*) FILTER (WHERE name = 'agent_limited')::int AS limited
    FROM events`,
};

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    return { query: async (sql) => (await pool.query(sql)).rows, close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(process.env.PGLITE_DIR ?? ".data/pglite");
  return { query: async (sql) => (await db.query(sql)).rows, close: () => db.close() };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");

/** Rows of [metric, value, PRD target]. `query` runs SQL and returns rows. */
export async function computeMetrics(query) {
  const [total] = await query(SQL.buildersTotal);
  const [recent] = await query(SQL.buildersLast8Weeks);
  const [ret] = await query(SQL.weekTwoReturn);
  const [exp] = await query(SQL.exportShare);
  const [build] = await query(SQL.medianBuildSeconds);
  const [agent] = await query(SQL.assistant);

  return [
    ["Beta users who built a model", `${recent.n} in 8 weeks (${total.n} all time)`, "100"],
    ["Week-2 return rate", `${pct(ret.returned, ret.eligible)} of ${ret.eligible} eligible users`, "30%+"],
    ["Models exported to .xlsx", `${pct(exp.exported, exp.models)} of ${exp.models} models`, "50%+"],
    ["Median time to first model", build.seconds == null ? "n/a" : `${build.seconds}s server build time`, "< 2 min"],
    ["Assistant suggestions accepted", `${pct(agent.accepted, agent.proposed)} of ${agent.proposed}`, "-"],
    ["Assistant requests refused by limits", String(agent.limited), "-"],
  ];
}

async function main() {
  const db = await connect();
  try {
    const rows = await computeMetrics(db.query);
    const width = Math.max(...rows.map((r) => r[0].length));
    console.log(`${"Metric".padEnd(width)}  Value  (PRD target)`);
    for (const [name, value, target] of rows) console.log(`${name.padEnd(width)}  ${value}  (${target})`);
    console.log("\nExtraction accuracy comes from `npm run eval:accuracy`; the 'very disappointed' score needs a survey.");
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
