// tests/runtime/_db.ts — load schema + seed into a LOCAL / throwaway Postgres for
// the runtime integration tests. Never point TEST_DATABASE_URL/DATABASE_URL at the
// production jvto_cms — this (re)loads the schema and seed. The whole runtime suite
// skips when neither var is set, so `npm test` stays green without Postgres.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
export const hasDb = Boolean(DB_URL);

/** Apply db/core/schema.sql then output/seed/load.sql (both idempotent). */
export async function loadSchemaAndSeed(): Promise<void> {
  if (DB_URL && !process.env.DATABASE_URL) process.env.DATABASE_URL = DB_URL;
  const { query } = await import('../../src/db.js'); // import AFTER env is set (lazy pool)
  const root = new URL('../../', import.meta.url);
  const schema = readFileSync(fileURLToPath(new URL('db/core/schema.sql', root)), 'utf8');
  const seed = readFileSync(fileURLToPath(new URL('output/seed/load.sql', root)), 'utf8');
  await query(schema); // multi-statement DDL via the simple query protocol
  await query(seed); // BEGIN … upserts … COMMIT
}
