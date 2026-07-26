// src/db.ts — Postgres access for the CMS read-runtime.
//
// Reads DATABASE_URL from the environment (never hardcoded). Points at `jvto_cms`
// (the editable content master); locally/CI at `jvto_cms_local`. Read paths issue
// SELECTs; the write API mutates inside withTransaction().
//
// The Pool is created lazily on first use so that importing this module never
// throws — modules that import it (e.g. the test suite) can be loaded even when
// DATABASE_URL is unset (the DB-backed tests skip in that case).

import pg from 'pg'; // pg is CommonJS — default-import the namespace under NodeNext.
import type { Pool as PoolType, PoolClient, QueryResult, QueryResultRow } from 'pg';

const { Pool } = pg;

let pool: PoolType | undefined;

/** Lazily construct (or return) the shared connection pool. */
export function getPool(): PoolType {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set — the CMS read-runtime requires a Postgres connection string.',
      );
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/** Run a parameterized query. Always pass a row type: without it rows are `any`. */
export async function query<Row extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: readonly unknown[],
): Promise<QueryResult<Row>> {
  return getPool().query<Row>(sql, params as unknown[] | undefined);
}

/** Run `fn` inside a transaction (BEGIN/COMMIT; ROLLBACK on throw). For write paths. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Close the pool (test teardown / graceful shutdown). Safe to call when unopened. */
export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = undefined;
    await p.end();
  }
}
