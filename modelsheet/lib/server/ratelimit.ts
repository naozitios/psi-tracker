import type { Queryable } from "../db";

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// The assistant limits are what stop a public deployment from spending
// unbounded API credits. Each is overridable per environment.
export const LIMITS = {
  agentPerUserHour: envNumber("AGENT_LIMIT_PER_USER_HOUR", 20),
  agentPerUserDay: envNumber("AGENT_LIMIT_PER_USER_DAY", 60),
  agentGlobalDay: envNumber("AGENT_LIMIT_GLOBAL_DAY", 500),
  buildsPerUserHour: envNumber("BUILD_LIMIT_PER_USER_HOUR", 20),
  editsPerUserMinute: envNumber("EDIT_LIMIT_PER_USER_MINUTE", 120),
  searchesPerIpMinute: envNumber("SEARCH_LIMIT_PER_IP_MINUTE", 60),
  newUsersPerIpHour: envNumber("NEW_USER_LIMIT_PER_IP_HOUR", 30),
  secRequestsPerSecond: 8,
};

export interface LimitResult {
  ok: boolean;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

/**
 * Counts one request against a fixed window shared by every server
 * instance, and reports whether it is within the limit.
 */
export async function hit(
  db: Queryable,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<LimitResult> {
  const [row] = await db.query<{ count: number; retry_after: number }>(
    `WITH w AS (
       SELECT to_timestamp(floor(extract(epoch FROM now()) / $2::int) * $2::int) AS start
     )
     INSERT INTO rate_limits (key, window_start, count)
     SELECT $1, w.start, 1 FROM w
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count,
       ceil(extract(epoch FROM (window_start + make_interval(secs => $2::int) - now())))::int AS retry_after`,
    [key, windowSeconds],
  );
  if (Math.random() < 0.01) {
    await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  }
  return { ok: row.count <= limit, retryAfter: Math.max(1, row.retry_after) };
}
