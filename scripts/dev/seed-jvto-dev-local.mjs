// scripts/dev/seed-jvto-dev-local.mjs
// Seed a LOCAL jvto_dev double (jvto_dev_local) so scripts/sync-to-jvto-dev.mjs can be
// PROVEN offline. NOT for production — the live jvto_dev already holds this data.
//
// Fills the target-schema.sql tables with a realistic starting state:
//   • content_pages: the real 71-row snapshot (data/releases/jvto-db/content-pages.json)
//     — jvto_dev's current pages (many overlap jvto_cms routes → will be REPLACED)
//   • + 2 synthetic jvto_dev-ONLY pages (/portal/booking, /portal/agent) → PRESERVE canaries
//   • organization_profile: the pulled org row (or a synthetic fallback)
//   • packages + destinations: one row per jvto_cms package/destination entity (by slug)
//     so the asset sync has FK targets to attach package_images / destination_assets
//   • folders (root) + 2 synthetic jvto_dev-ONLY assets → PRESERVE canaries
//
// Usage: JVTO_DEV_URL=postgresql://postgres@localhost:5432/jvto_dev_local \
//        node scripts/dev/seed-jvto-dev-local.mjs
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = process.cwd();
const URL = process.env.JVTO_DEV_URL || 'postgresql://postgres@localhost:5432/jvto_dev_local';
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

async function main() {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    // clean slate (respect FK order)
    await client.query(`TRUNCATE destination_assets, package_assets, package_images, asset_tags,
      assets, tags_assets, folders, content_pages, organization_profile, site_identity,
      packages, destinations RESTART IDENTITY CASCADE`);

    // ── content_pages: real snapshot ──
    const snap = readJson('data/releases/jvto-db/content-pages.json');
    let cp = 0;
    for (const r of snap.rows) {
      await client.query(
        `INSERT INTO content_pages (route, lang, seo, content, is_active)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, true)
         ON CONFLICT (route, lang) DO NOTHING`,
        [r.route, r.lang || 'en', JSON.stringify(r.seo ?? {}), JSON.stringify(r.content ?? {})],
      );
      cp++;
    }
    // 2 jvto_dev-ONLY pages the CMS never manages — must survive the sync
    for (const route of ['/portal/booking', '/portal/agent']) {
      await client.query(
        `INSERT INTO content_pages (route, lang, seo, content, is_active)
         VALUES ($1, 'en', '{"title":"jvto_dev-only"}'::jsonb,
                 '{"h1":"jvto_dev only — preserve me","sections":[]}'::jsonb, true)
         ON CONFLICT (route, lang) DO NOTHING`,
        [route],
      );
    }

    // ── organization_profile ──
    let org = null;
    try { org = readJson('data/releases/jvto-db/organization_profile.json'); } catch { /* optional */ }
    await client.query(
      `INSERT INTO organization_profile (legal_name, brand_name, founding_date, description, website_url, logo_url, hero_image_url, schema_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        org?.legal_name ?? 'PT Java Volcano Tour Operator',
        org?.brand_name ?? 'Java Volcano Tour Operator',
        org?.founding_date ?? '2015-01-01',
        org?.description ?? 'Tourist Police-led private volcano tours in East Java.',
        org?.website_url ?? 'https://javavolcano-touroperator.com',
        org?.logo_url ?? null,
        org?.hero_image_url ?? null,
        JSON.stringify(org?.schema_json ?? {}),
      ],
    );

    // ── FK targets: packages + destinations from jvto_cms entities (by slug) ──
    const entities = readJson('output/seed/entities.json');
    const pkgs = entities.filter((e) => e.entity_type === 'package');
    const dests = entities.filter((e) => e.entity_type === 'destination');
    for (const p of pkgs) {
      await client.query(
        `INSERT INTO packages (code, name, slug) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
        [p.slug, p.title ?? p.slug, p.slug],
      );
    }
    // destinations keyed by the canonical LONG slug (matches jvto_dev + live routes)
    const DEST_SLUG = {
      'mount-bromo': 'mount-bromo', 'kawah-ijen': 'ijen-crater',
      'tumpak-sewu': 'tumpak-sewu-waterfall', 'madakaripura': 'madakaripura-waterfall',
      'papuma-beach': 'papuma-beach', 'papuma': 'papuma-beach',
    };
    for (const d of dests) {
      const slug = DEST_SLUG[d.slug] || d.slug;
      await client.query(
        `INSERT INTO destinations (code, name, slug) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
        [d.slug, d.title ?? d.slug, slug],
      );
    }

    // ── folders + 2 jvto_dev-ONLY assets (preserve canaries) ──
    const folder = await client.query(
      `INSERT INTO folders (name) VALUES ('root') RETURNING id`,
    );
    const rootFolder = folder.rows[0].id;
    for (const a of [
      { name: 'legacy-hero.jpg', url: 'https://legacy.javavolcano-touroperator.com/assets/img/hero/home.webp' },
      { name: 'legacy-logo.png', url: 'https://legacy.javavolcano-touroperator.com/assets/img/jvto-color.png' },
    ]) {
      await client.query(
        `INSERT INTO assets (folder_id, name, type, url, is_active) VALUES ($1,$2,'image',$3,true)`,
        [rootFolder, a.name, a.url],
      );
    }

    await client.query('COMMIT');

    const counts = await client.query(`SELECT
      (SELECT count(*) FROM content_pages) content_pages,
      (SELECT count(*) FROM content_pages WHERE route LIKE '/portal/%') dev_only_pages,
      (SELECT count(*) FROM organization_profile) org,
      (SELECT count(*) FROM packages) packages,
      (SELECT count(*) FROM destinations) destinations,
      (SELECT count(*) FROM folders) folders,
      (SELECT count(*) FROM assets) assets`);
    console.log('jvto_dev_local seeded:', JSON.stringify(counts.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
