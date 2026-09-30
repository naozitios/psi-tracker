import { describe, expect, it } from "vitest";
import { connectPglite, migrate } from "@/lib/db";
import { computeMetrics } from "../scripts/metrics.mjs";

describe("success metrics", () => {
  it("computes the PRD table from events", async () => {
    const db = await connectPglite();
    await migrate(db);
    const users = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
    for (const id of users) await db.query("INSERT INTO users (id) VALUES ($1)", [id]);
    const event = (user: string, name: string, daysAgo: number, model: string, ms = 0) =>
      db.query(
        `INSERT INTO events (user_id, model_id, name, props, created_at)
         VALUES ($1, $2, $3, $4::jsonb, now() - make_interval(days => $5))`,
        [user, model, name, JSON.stringify({ ms }), daysAgo],
      );
    // User 1 returns within two weeks and exports; user 2 never returns; user 3 is too new to count.
    await event(users[0], "model_built", 30, "00000000-0000-4000-8000-00000000000a", 4000);
    await event(users[0], "model_built", 25, "00000000-0000-4000-8000-00000000000b", 2000);
    await event(users[0], "export_downloaded", 25, "00000000-0000-4000-8000-00000000000b");
    await event(users[1], "model_built", 20, "00000000-0000-4000-8000-00000000000c", 6000);
    await event(users[2], "model_built", 2, "00000000-0000-4000-8000-00000000000d", 8000);
    await event(users[2], "proposal_created", 2, "00000000-0000-4000-8000-00000000000d");
    await event(users[2], "proposal_accepted", 2, "00000000-0000-4000-8000-00000000000d");

    const rows = Object.fromEntries((await computeMetrics((sql) => db.query(sql))).map(([k, v]) => [k, v]));
    expect(rows["Beta users who built a model"]).toBe("3 in 8 weeks (3 all time)");
    expect(rows["Week-2 return rate"]).toBe("50% of 2 eligible users");
    expect(rows["Models exported to .xlsx"]).toBe("25% of 4 models");
    expect(rows["Median time to first model"]).toBe("6s server build time");
    expect(rows["Assistant suggestions accepted"]).toBe("100% of 1");
    await db.close();
  });
});
