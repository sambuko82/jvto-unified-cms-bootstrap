// scripts/sync-to-jvto-dev.mjs
// Push the jvto_cms edit-master content into the live jvto-web Postgres DB (jvto_dev):
// pages, org identity, and the media/asset registry — replacing matching rows, PRESERVING
// jvto_dev-only rows, maintaining FK/relationships, with an audit report + rollback SQL.
//
//   SOURCE  jvto_cms   (CMS_DATABASE_URL, defaults to DATABASE_URL) — read-only here
//   TARGET  jvto_dev   (JVTO_DEV_DATABASE_URL)                      — upserted
//
// Direction is jvto_cms -> jvto_dev. Idempotent (ON CONFLICT DO UPDATE); NEVER truncates.
// Console edits (editable=true assets / page_content) ride along because we read the live
// jvto_cms rows, not the committed seed. Content is a faithful round-trip: the CMS
// `page_content` section already holds jvto_dev's native content shape.
//
// "Full restructuring" (user-approved) lands additively in a CMS-owned `cms` schema
// (cms.pages, cms.page_sections, cms.templates, cms.asset_map, cms.sync_log) — the richer
// normalized model — which then PROJECTS into the tables jvto-web reads (content_pages,
// organization_profile, assets). jvto-web keeps working unchanged; a future jvto-web can
// read cms.* directly. No existing jvto_dev table is altered or dropped.
//
// Usage:
//   CMS_DATABASE_URL=…/jvto_cms  JVTO_DEV_DATABASE_URL=…/jvto_dev  node scripts/sync-to-jvto-dev.mjs [--plan]
//   --plan  → dry run: compute + report every change, write NOTHING (transaction rolled back).
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = process.cwd();
const PLAN = process.argv.includes('--plan');
const CMS_URL = process.env.CMS_DATABASE_URL || process.env.DATABASE_URL;
const DEV_URL = process.env.JVTO_DEV_DATABASE_URL;
const RUN_ID = process.env.SYNC_RUN_ID || 'local'; // Date.now() is unavailable in some runners; caller may pass one
const OUT_DIR = path.join(root, 'output/sync');

if (!CMS_URL) { console.error('CMS_DATABASE_URL (or DATABASE_URL) is required (source jvto_cms).'); process.exit(2); }
if (!DEV_URL) { console.error('JVTO_DEV_DATABASE_URL is required (target jvto_dev).'); process.exit(2); }

// Build the pg client from EXPLICIT fields (never pass connectionString together with
// ssl — the URL's sslmode would override our ssl object and force cert verification,
// which fails on jvto_dev's self-signed cert: DEPTH_ZERO_SELF_SIGNED_CERT).
// Remote host (not localhost) → TLS but accept the self-signed cert (we connect by IP).
// localhost/test → plaintext. sslmode=disable in the URL forces TLS off.
function pgClient(connectionString) {
  const u = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  const disable = u.searchParams.get('sslmode') === 'disable';
  return new pg.Client({
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    ssl: local || disable ? false : { rejectUnauthorized: false },
  });
}

const sqlLit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const jLit = (v) => `'${JSON.stringify(v ?? null).replace(/'/g, "''")}'::jsonb`;

// ── 1) READ the source (jvto_cms) ─────────────────────────────────────────────
async function readSource() {
  const src = pgClient(CMS_URL);
  await src.connect();
  try {
    // page_render pre-assembles {route, seo, sections[]}; the page_content section carries
    // jvto_dev's native content JSON. Fall back to a minimal body if a route lacks one.
    const pages = (await src.query('SELECT route, seo, sections FROM page_render ORDER BY route')).rows;
    const contentPages = [];
    for (const p of pages) {
      const sections = Array.isArray(p.sections) ? p.sections : [];
      const pc = sections.find((s) => s.type === 'page_content');
      const content = pc?.content ?? { h1: (p.seo && p.seo.title) || p.route, sections: [] };
      contentPages.push({ route: p.route, lang: 'en', seo: p.seo ?? {}, content });
    }
    // full normalized section model (for the cms.* restructured store)
    const sections = (await src.query(
      `SELECT p.route, s.sort_order, s.section_type, s.variant, s.content, s.entity_refs, s.asset_refs
         FROM pages p JOIN page_sections s ON s.page_id = p.id ORDER BY p.route, s.sort_order`,
    )).rows;
    const templates = (await src.query(
      'SELECT route, template, visual_mode, page_type, cluster FROM pages ORDER BY route',
    )).rows;
    const assets = (await src.query(
      'SELECT key, kind, url, alt, meta, editable FROM assets WHERE key IS NOT NULL ORDER BY key',
    )).rows;
    const facts = (await src.query('SELECT key, value FROM governance_facts')).rows;
    return { contentPages, sections, templates, assets, facts };
  } finally {
    await src.end();
  }
}

// Derive organization_profile field overrides from the asset registry (operator image swaps
// reach live branding here) + governance facts.
function orgOverrides(assets, facts) {
  const o = {};
  for (const a of assets) {
    const link = a.meta && a.meta.link;
    if (link && link.type === 'org' && link.field) o[link.field] = a.url; // hero_image_url / logo_url
  }
  const factMap = Object.fromEntries(facts.map((f) => [f.key, f.value]));
  if (factMap.founding_year || factMap.founding_date) o.founding_date = String(factMap.founding_date || `${factMap.founding_year}-01-01`);
  return o;
}

// ── 2) WRITE to the target (jvto_dev), transactional, with pre-image capture ───
async function main() {
  const source = await readSource();
  const dev = pgClient(DEV_URL);
  await dev.connect();
  const report = { run_id: RUN_ID, mode: PLAN ? 'plan' : 'apply', tables: {}, preserved: {} };
  const rollback = [`-- output/sync/rollback.sql — restores jvto_dev to its pre-sync state (run ${RUN_ID}).`, 'BEGIN;'];

  try {
    await dev.query('BEGIN');

    // ── additive CMS-owned "restructured" layer (never touches jvto-web's tables) ──
    await dev.query(`CREATE SCHEMA IF NOT EXISTS cms`);
    await dev.query(`CREATE TABLE IF NOT EXISTS cms.pages (
      route text, lang text DEFAULT 'en', seo jsonb, content jsonb, updated_at timestamptz DEFAULT now(),
      PRIMARY KEY (route, lang))`);
    await dev.query(`CREATE TABLE IF NOT EXISTS cms.page_sections (
      route text, sort_order int, section_type text, variant text, content jsonb,
      entity_refs text[], asset_refs text[], PRIMARY KEY (route, sort_order))`);
    await dev.query(`CREATE TABLE IF NOT EXISTS cms.templates (
      route text PRIMARY KEY, template text, visual_mode text, page_type text, cluster text)`);
    await dev.query(`CREATE TABLE IF NOT EXISTS cms.asset_map (
      cms_key text PRIMARY KEY, asset_id bigint, url text, updated_at timestamptz DEFAULT now())`);
    await dev.query(`CREATE TABLE IF NOT EXISTS cms.sync_log (
      run_id text, at timestamptz DEFAULT now(), mode text, report jsonb)`);

    // ── ensure an asset folder exists (assets.folder_id is NOT NULL) ──
    let folderId = (await dev.query(`SELECT id FROM folders WHERE name = 'cms-managed' LIMIT 1`)).rows[0]?.id;
    if (!folderId) {
      if (PLAN) folderId = -1;
      else folderId = (await dev.query(`INSERT INTO folders (name) VALUES ('cms-managed') RETURNING id`)).rows[0].id;
    }

    // ── (a) content_pages: upsert by (route, lang); preserve jvto_dev-only rows ──
    const cpStats = { inserted: 0, updated: 0 };
    for (const cp of source.contentPages) {
      const before = (await dev.query('SELECT content, seo, is_active FROM content_pages WHERE route = $1 AND lang = $2', [cp.route, cp.lang])).rows[0];
      // mirror into the restructured store
      if (!PLAN) await dev.query(
        `INSERT INTO cms.pages (route, lang, seo, content, updated_at) VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (route, lang) DO UPDATE SET seo = EXCLUDED.seo, content = EXCLUDED.content, updated_at = now()`,
        [cp.route, cp.lang, cp.seo, cp.content]);
      if (before) {
        cpStats.updated++;
        rollback.push(`UPDATE content_pages SET content=${jLit(before.content)}, seo=${jLit(before.seo)}, is_active=${before.is_active} WHERE route=${sqlLit(cp.route)} AND lang=${sqlLit(cp.lang)};`);
      } else {
        cpStats.inserted++;
        rollback.push(`DELETE FROM content_pages WHERE route=${sqlLit(cp.route)} AND lang=${sqlLit(cp.lang)};`);
      }
      if (!PLAN) await dev.query(
        `INSERT INTO content_pages (route, lang, seo, content, is_active) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (route, lang) DO UPDATE SET seo = EXCLUDED.seo, content = EXCLUDED.content, updated_at = now()`,
        [cp.route, cp.lang, cp.seo, cp.content]);
    }
    report.tables.content_pages = cpStats;
    // jvto_dev-only rows = content_pages whose route the CMS does not manage (left intact)
    const cmsRoutes = source.contentPages.map((c) => c.route);
    report.preserved.content_pages = Number((await dev.query(
      'SELECT count(*) n FROM content_pages WHERE route <> ALL($1::text[])', [cmsRoutes],
    )).rows[0].n);

    // ── cms.page_sections + cms.templates (restructured model mirror) ──
    if (!PLAN) {
      for (const s of source.sections)
        await dev.query(
          `INSERT INTO cms.page_sections (route, sort_order, section_type, variant, content, entity_refs, asset_refs)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (route, sort_order) DO UPDATE SET section_type=EXCLUDED.section_type, variant=EXCLUDED.variant,
             content=EXCLUDED.content, entity_refs=EXCLUDED.entity_refs, asset_refs=EXCLUDED.asset_refs`,
          [s.route, s.sort_order, s.section_type, s.variant, s.content, s.entity_refs, s.asset_refs]);
      for (const t of source.templates)
        await dev.query(
          `INSERT INTO cms.templates (route, template, visual_mode, page_type, cluster) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (route) DO UPDATE SET template=EXCLUDED.template, visual_mode=EXCLUDED.visual_mode,
             page_type=EXCLUDED.page_type, cluster=EXCLUDED.cluster`,
          [t.route, t.template, t.visual_mode, t.page_type, t.cluster]);
    }

    // ── (b) assets: idempotent upsert via cms.asset_map (jvto_dev.assets has no natural key) ──
    const aStats = { inserted: 0, updated: 0 };
    for (const a of source.assets) {
      const kind = a.kind === 'image' || a.kind === 'video' || a.kind === 'document' ? a.kind : 'image';
      const mapped = (await dev.query('SELECT asset_id FROM cms.asset_map WHERE cms_key = $1', [a.key])).rows[0];
      // jvto_dev.assets has no `alt` column — alt text maps to `description`; caption to `caption`.
      if (mapped && mapped.asset_id) {
        const before = (await dev.query('SELECT url, caption, description FROM assets WHERE id = $1', [mapped.asset_id])).rows[0];
        if (before) rollback.push(`UPDATE assets SET url=${sqlLit(before.url)}, caption=${sqlLit(before.caption)}, description=${sqlLit(before.description)} WHERE id=${mapped.asset_id};`);
        aStats.updated++;
        if (!PLAN) {
          await dev.query('UPDATE assets SET url=$1, caption=$2, description=$3 WHERE id=$4', [a.url, a.meta?.caption ?? null, a.alt ?? null, mapped.asset_id]);
          await dev.query('UPDATE cms.asset_map SET url=$1, updated_at=now() WHERE cms_key=$2', [a.url, a.key]);
        }
      } else {
        aStats.inserted++;
        if (!PLAN) {
          const id = (await dev.query(
            `INSERT INTO assets (folder_id, name, caption, description, type, url, is_active) VALUES ($1,$2,$3,$4,$5::asset_type,$6,true) RETURNING id`,
            [folderId, a.key, a.meta?.caption ?? null, a.alt ?? null, kind, a.url])).rows[0].id;
          await dev.query('INSERT INTO cms.asset_map (cms_key, asset_id, url) VALUES ($1,$2,$3)', [a.key, id, a.url]);
          rollback.push(`DELETE FROM assets WHERE id=${id};`);
          rollback.push(`DELETE FROM cms.asset_map WHERE asset_id=${id};`);
        }
      }
    }
    report.tables.assets = aStats;
    report.preserved.assets = Number((await dev.query('SELECT count(*) n FROM assets WHERE id NOT IN (SELECT asset_id FROM cms.asset_map WHERE asset_id IS NOT NULL)')).rows[0].n);

    // ── (c) organization_profile: hero/logo from (possibly operator-swapped) assets + facts ──
    const ov = orgOverrides(source.assets, source.facts);
    let orgStat = 'unchanged';
    if (Object.keys(ov).length) {
      const before = (await dev.query('SELECT id, logo_url, hero_image_url, founding_date FROM organization_profile ORDER BY id LIMIT 1')).rows[0];
      if (before) {
        rollback.push(`UPDATE organization_profile SET logo_url=${sqlLit(before.logo_url)}, hero_image_url=${sqlLit(before.hero_image_url)}, founding_date=${before.founding_date ? sqlLit(before.founding_date.toISOString?.().slice(0,10) ?? before.founding_date) : 'NULL'} WHERE id=${before.id};`);
        orgStat = 'updated';
        if (!PLAN) await dev.query(
          `UPDATE organization_profile SET logo_url=COALESCE($1,logo_url), hero_image_url=COALESCE($2,hero_image_url),
             founding_date=COALESCE($3::date,founding_date), updated_at=now() WHERE id=$4`,
          [ov.logo_url ?? null, ov.hero_image_url ?? null, ov.founding_date ?? null, before.id]);
      }
    }
    report.tables.organization_profile = orgStat;
    report.overrides = ov;

    rollback.push('COMMIT;');
    if (!PLAN) await dev.query(`INSERT INTO cms.sync_log (run_id, mode, report) VALUES ($1,$2,$3)`, [RUN_ID, report.mode, report]);

    if (PLAN) { await dev.query('ROLLBACK'); }
    else { await dev.query('COMMIT'); }

    // ── 3) write audit report + rollback ──
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'jvto-dev-report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(OUT_DIR, 'rollback.sql'), rollback.join('\n') + '\n');
    const md = [
      `# jvto_cms → jvto_dev sync report (${report.mode})`, '',
      `- content_pages: **${cpStats.inserted} inserted, ${cpStats.updated} updated**; ${report.preserved.content_pages} jvto_dev-only rows preserved`,
      `- assets: **${aStats.inserted} inserted, ${aStats.updated} updated**; ${report.preserved.assets} jvto_dev-only assets preserved`,
      `- organization_profile: ${orgStat}${Object.keys(ov).length ? ` (${Object.keys(ov).join(', ')})` : ''}`,
      `- cms.* restructured mirror: ${source.sections.length} sections, ${source.templates.length} templates`,
      '', `Rollback: \`psql "$JVTO_DEV_DATABASE_URL" -f output/sync/rollback.sql\``,
    ].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, 'jvto-dev-report.md'), md + '\n');

    console.log(
      `${PLAN ? '[PLAN] ' : ''}sync jvto_cms→jvto_dev: content_pages +${cpStats.inserted}/~${cpStats.updated} ` +
        `(preserved ${report.preserved.content_pages}), assets +${aStats.inserted}/~${aStats.updated} ` +
        `(preserved ${report.preserved.assets}), org ${orgStat}. Report → output/sync/.`,
    );
  } catch (e) {
    await dev.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await dev.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
