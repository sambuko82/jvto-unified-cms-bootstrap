// tests/sync/sync.test.ts — integration proof for scripts/sync-to-jvto-dev.mjs.
// Stands up a local jvto_dev double (jvto_dev_local) in the same Postgres the runtime
// suite uses, seeds it (real 71-row content_pages snapshot + dev-only canaries), then runs
// the jvto_cms -> jvto_dev sync TWICE and asserts: replace + preserve + idempotency +
// content round-trip + cms.* restructured mirror + FK integrity. Skips when no DB configured.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { hasDb, DB_URL, loadSchemaAndSeed } from '../runtime/_db.js';

const pexec = promisify(execFile);
const root = new URL('../../', import.meta.url);
const p = (rel: string) => fileURLToPath(new URL(rel, root));
const withDb = (base: string, db: string) => { const u = new URL(base); u.pathname = '/' + db; return u.toString(); };

describe.skipIf(!hasDb)('jvto_cms -> jvto_dev sync (integration)', () => {
  const CMS_URL = DB_URL as string;
  const DEV_URL = withDb(CMS_URL, 'jvto_dev_local');
  let dev: pg.Client;

  beforeAll(async () => {
    await loadSchemaAndSeed(); // jvto_cms_local: schema + committed seed

    // (re)create the jvto_dev double
    const admin = new pg.Client({ connectionString: withDb(CMS_URL, 'postgres') });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS jvto_dev_local WITH (FORCE)');
    await admin.query('CREATE DATABASE jvto_dev_local');
    await admin.end();

    dev = new pg.Client({ connectionString: DEV_URL });
    await dev.connect();
    await dev.query(readFileSync(p('db/jvto-dev/target-schema.sql'), 'utf8'));
    await pexec('node', [p('scripts/dev/seed-jvto-dev-local.mjs')],
      { env: { ...process.env, JVTO_DEV_URL: DEV_URL }, cwd: p('.') });

    // run the sync TWICE (second run proves idempotency)
    const env = { ...process.env, CMS_DATABASE_URL: CMS_URL, JVTO_DEV_DATABASE_URL: DEV_URL, SYNC_RUN_ID: 'test' };
    await pexec('node', [p('scripts/sync-to-jvto-dev.mjs')], { env, cwd: p('.') });
    await pexec('node', [p('scripts/sync-to-jvto-dev.mjs')], { env, cwd: p('.') });
  }, 90_000);

  afterAll(async () => { if (dev) await dev.end(); });

  const n = async (sql: string) => Number((await dev.query(sql)).rows[0].n);

  it('replaces matching content_pages and preserves jvto_dev-only rows', async () => {
    // 73 seeded (71 snapshot + 2 canary) + 13 CMS-only routes inserted = 86
    expect(await n('SELECT count(*) n FROM content_pages')).toBe(86);
    // all 76 CMS routes are present
    expect(await n('SELECT count(*) n FROM content_pages cp WHERE EXISTS (SELECT 1 FROM cms.pages c WHERE c.route = cp.route)')).toBe(76);
    // the two jvto_dev-only canary pages survive untouched
    expect(await n("SELECT count(*) n FROM content_pages WHERE route LIKE '/portal/%'")).toBe(2);
  });

  it('round-trips page content into jvto_dev native shape', async () => {
    const { rows } = await dev.query<{ h1: string }>(
      `SELECT content->>'h1' AS h1 FROM content_pages WHERE route = '/contact' AND lang = 'en'`,
    );
    expect(rows[0]?.h1).toBe('Contact Java Volcano Tour Operator');
  });

  it('syncs the asset registry idempotently and preserves jvto_dev-only assets', async () => {
    expect(await n('SELECT count(*) n FROM cms.asset_map')).toBe(54);        // 54 CMS assets mapped
    expect(await n('SELECT count(*) n FROM assets')).toBe(56);               // 54 synced + 2 canary
    expect(await n("SELECT count(*) n FROM assets WHERE url LIKE '%legacy.javavolcano%'")).toBe(2); // canaries
    // no duplicates after two runs
    expect(await n('SELECT count(*) n FROM (SELECT route, lang FROM content_pages GROUP BY route, lang HAVING count(*) > 1) d')).toBe(0);
    expect(await n('SELECT count(*) n FROM (SELECT cms_key FROM cms.asset_map GROUP BY cms_key HAVING count(*) > 1) d')).toBe(0);
  });

  it('updates organization branding and mirrors the cms.* restructured model with FK integrity', async () => {
    expect(await n('SELECT count(*) n FROM organization_profile WHERE hero_image_url IS NOT NULL AND logo_url IS NOT NULL')).toBe(1);
    expect(await n('SELECT count(*) n FROM cms.pages')).toBe(76);
    expect(await n('SELECT count(*) n FROM cms.page_sections')).toBe(306);
    expect(await n('SELECT count(*) n FROM cms.templates')).toBe(76);
    expect(await n('SELECT count(*) n FROM assets a LEFT JOIN folders f ON f.id = a.folder_id WHERE f.id IS NULL')).toBe(0);
  });
});
