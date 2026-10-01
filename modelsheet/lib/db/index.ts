import { MIGRATIONS } from "./migrations";

export interface Queryable {
  /** One statement with $1-style parameters. Pass JSON as a string cast to ::jsonb. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Several statements, no parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class DbConfigError extends Error {}

async function connectPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE ?? 5) });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pool.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: async <R>(sql: string, params: unknown[] = []) =>
            (await client.query(sql, params)).rows as R[],
          exec: async (sql: string) => {
            await client.query(sql);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres for local development and tests. */
export async function connectPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir && !dataDir.includes("://")) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dataDir, { recursive: true });
  }
  const db = new PGlite(dataDir);
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      return db.transaction((tx) =>
        fn({
          query: async <R>(sql: string, params: unknown[] = []) => (await tx.query<R>(sql, params)).rows,
          exec: async (sql: string) => {
            await tx.exec(sql);
          },
        }),
      );
    },
    close: () => db.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.transaction(async (tx) => {
    // Serialize migrations when several instances start at once.
    await tx.query("SELECT pg_advisory_xact_lock(727401)");
    const applied = new Set(
      (await tx.query<{ id: string }>("SELECT id FROM schema_migrations")).map((r) => r.id),
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    }
  });
}

let current: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  let db: Db;
  if (url) {
    db = await connectPostgres(url);
  } else if (process.env.NODE_ENV === "production") {
    throw new DbConfigError("DATABASE_URL is not set. Production needs a Postgres database.");
  } else {
    db = await connectPglite(process.env.PGLITE_DIR ?? ".data/pglite");
  }
  await migrate(db);
  return db;
}

export function getDb(): Promise<Db> {
  current ??= open().catch((err) => {
    current = null;
    throw err;
  });
  return current;
}

/** Tests swap in an in-memory database. */
export function setDb(db: Db | null): void {
  current = db ? Promise.resolve(db) : null;
}
