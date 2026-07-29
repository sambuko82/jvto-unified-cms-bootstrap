// sync-template.mjs — idempotent, preserve-only sync from a SOURCE Postgres to a LIVE
// TARGET Postgres. Adapt the two marked sections; the engine (plan/apply, upsert, prune,
// mapping-table idempotency, audit report, rollback) is reusable as-is.
//
//   SOURCE  = SOURCE_DATABASE_URL (or DATABASE_URL) — read-only here
//   TARGET  = TARGET_DATABASE_URL                    — upserted, never truncated
//
// Run:  node sync-template.mjs [--plan]
//   --plan → open a txn, compute every change + the report, then ROLLBACK (writes nothing).
//   (no flag) → commit the changes.
//
// Guarantees: every row the SOURCE owns is upserted by a natural key; rows the source does
// NOT own are never touched; re-running is a no-op (prove with two runs). Each run writes
// output/sync/report.{json,md} and rollback.sql (pre-image of touched rows).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { pgClient } from './pg-client.mjs';

const PLAN = process.argv.includes('--plan');
const SRC = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
const DST = process.env.TARGET_DATABASE_URL;
const RUN_ID = process.env.SYNC_RUN_ID || 'local'; // pass github.run_id in CI (no Date.now())
const OUT = path.join(process.cwd(), 'output/sync');
if (!SRC) { console.error('SOURCE_DATABASE_URL (or DATABASE_URL) required'); process.exit(2); }
if (!DST) { console.error('TARGET_DATABASE_URL required'); process.exit(2); }

// SQL literal helpers for the rollback file (string + jsonb).
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const j = (v) => `'${JSON.stringify(v ?? null).replace(/'/g, "''")}'::jsonb`;

async function main() {
  // ── 1) READ the source ────────────────────────────────────────────────────
  // TODO(adapt): pull the rows you will project into the target. Keep it to plain data;
  // assemble target-native shapes here. Example:
  const src = pgClient(SRC, pg);
  await src.connect();
  let sourceRows;
  try {
    sourceRows = (await src.query(
      // e.g. the pre-assembled page view: route is the natural upsert key
      'SELECT route, lang, seo, content FROM source_pages ORDER BY route'
    )).rows;
  } finally { await src.end(); }

  // ── 2) WRITE the target (transactional; pre-image captured for rollback) ────
  const dst = pgClient(DST, pg);
  await dst.connect();
  const report = { run_id: RUN_ID, mode: PLAN ? 'plan' : 'apply', tables: {}, preserved: {} };
  const rollback = [`-- rollback.sql — restores the target to its pre-sync state (run ${RUN_ID}).`, 'BEGIN;'];

  try {
    await dst.query('BEGIN');

    // Additive CMS-owned layer + idempotency map — never touches the app's own tables.
    // TODO(adapt/keep): create only what you need. The asset_map pattern gives idempotent
    // upserts for tables that have NO natural unique key.
    await dst.query('CREATE SCHEMA IF NOT EXISTS cms');
    await dst.query(`CREATE TABLE IF NOT EXISTS cms.sync_log (run_id text, at timestamptz DEFAULT now(), mode text, report jsonb)`);
    await dst.query(`CREATE TABLE IF NOT EXISTS cms.key_map (cms_key text PRIMARY KEY, target_id bigint, updated_at timestamptz DEFAULT now())`);

    // ── (a) upsert-by-natural-key table (the common case) ──
    // Preserve-only: we never delete rows whose key the source doesn't own.
    const stats = { inserted: 0, updated: 0 };
    for (const r of sourceRows) {
      const before = (await dst.query(
        'SELECT seo, content FROM content_pages WHERE route = $1 AND lang = $2', [r.route, r.lang]
      )).rows[0];
      if (before) {
        stats.updated++;
        rollback.push(`UPDATE content_pages SET seo=${j(before.seo)}, content=${j(before.content)} WHERE route=${q(r.route)} AND lang=${q(r.lang)};`);
      } else {
        stats.inserted++;
        rollback.push(`DELETE FROM content_pages WHERE route=${q(r.route)} AND lang=${q(r.lang)};`);
      }
      if (!PLAN) await dst.query(
        `INSERT INTO content_pages (route, lang, seo, content, is_active) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (route, lang) DO UPDATE SET seo=EXCLUDED.seo, content=EXCLUDED.content, updated_at=now()`,
        [r.route, r.lang, r.seo, r.content]  // pg stringifies objects → jsonb automatically
      );
    }
    report.tables.content_pages = stats;
    // preserved = target rows whose key the source does NOT own (computed live, mode-safe)
    const ownedKeys = sourceRows.map((r) => r.route);
    report.preserved.content_pages = Number((await dst.query(
      'SELECT count(*) n FROM content_pages WHERE route <> ALL($1::text[])', [ownedKeys]
    )).rows[0].n);

    // OPTIONAL prune: remove rows the source used to own but dropped. ONLY if this sync is
    // authoritative for a delimited namespace — never a blanket delete.
    //   DELETE FROM content_pages WHERE <source-owned predicate> AND route <> ALL($1::text[]);

    // ── (b) keyless table via mapping (e.g. assets: no natural unique key) ──
    // TODO(adapt): idempotent insert/update through cms.key_map so re-runs don't duplicate.
    //   const mapped = (await dst.query('SELECT target_id FROM cms.key_map WHERE cms_key=$1',[key])).rows[0];
    //   if (mapped) { UPDATE assets ... WHERE id=mapped.target_id }
    //   else { id = INSERT assets ... RETURNING id; INSERT cms.key_map(cms_key,target_id) }
    //   rollback: inserted → DELETE assets id + DELETE cms.key_map; updated → UPDATE back.

    rollback.push('COMMIT;');
    if (!PLAN) await dst.query('INSERT INTO cms.sync_log (run_id, mode, report) VALUES ($1,$2,$3)', [RUN_ID, report.mode, report]);
    await dst.query(PLAN ? 'ROLLBACK' : 'COMMIT');

    // ── 3) emit audit report + rollback ──
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT, 'rollback.sql'), rollback.join('\n') + '\n');
    fs.writeFileSync(path.join(OUT, 'report.md'), [
      `# sync report (${report.mode})`, '',
      `- content_pages: **${stats.inserted} inserted, ${stats.updated} updated**; ${report.preserved.content_pages} target-only rows preserved`,
      '', 'Rollback: `psql "$TARGET_DATABASE_URL" -f output/sync/rollback.sql`',
    ].join('\n') + '\n');
    console.log(`${PLAN ? '[PLAN] ' : ''}sync: content_pages +${stats.inserted}/~${stats.updated} (preserved ${report.preserved.content_pages}).`);
  } catch (e) {
    await dst.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { await dst.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
