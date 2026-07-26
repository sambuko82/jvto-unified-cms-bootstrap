// Export the SEED PACK straight from a live jvto_cms database (the EDIT MASTER),
// the reverse of load.sql. This is the publish path: once the CMS console edits
// jvto_cms, this dump regenerates output/seed/* in the exact shape build-seed.mjs
// emits, so jvto-web's sync:cms-seed consumes console edits with zero shape change.
//
// build-seed.mjs = upstream (3 data repos + design-system) → seed  [initial populate]
// export-cms-seed.mjs = jvto_cms (edited) → seed                    [publish edits]
//
// Usage: DATABASE_URL=postgres://…/jvto_cms  node scripts/export-cms-seed.mjs [--out <dir>]
// Reads DB only (SELECT); never writes the DB. Deterministic ordering so re-runs
// over an unchanged DB are byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const root = process.cwd();
const outArgIdx = process.argv.indexOf('--out');
const OUT = path.resolve(root, outArgIdx > -1 ? process.argv[outArgIdx + 1] : 'output/seed');
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('export-cms-seed: DATABASE_URL is required (points at jvto_cms).');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const byKey = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
const write = (name, obj) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2) + '\n');

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  // ── entities (atoms; read-only synced + editable page content live together) ──
  const entities = (
    await client.query(
      `SELECT entity_type, canonical_key, slug, title, data, provenance, source, editable
         FROM entities`,
    )
  ).rows
    .map((e) => ({
      entity_type: e.entity_type,
      canonical_key: e.canonical_key,
      slug: e.slug,
      title: e.title,
      data: e.data ?? {},
      provenance: e.provenance ?? {},
      source: e.source,
      editable: e.editable,
    }))
    .sort(byKey('canonical_key'));

  // ── pages (IA) ──
  const pages = (
    await client.query(
      `SELECT route, file_group, sort_order, cluster, page_type, template,
              visual_mode, hub_route, title, h1, seo, status
         FROM pages`,
    )
  ).rows
    .map((p) => ({
      route: p.route,
      file_group: p.file_group,
      sort_order: p.sort_order,
      cluster: p.cluster,
      page_type: p.page_type,
      template: p.template,
      visual_mode: p.visual_mode,
      hub_route: p.hub_route,
      title: p.title,
      h1: p.h1,
      seo: p.seo ?? {},
      status: p.status,
    }))
    .sort((a, b) =>
      a.file_group !== b.file_group
        ? a.file_group < b.file_group
          ? -1
          : 1
        : a.sort_order !== b.sort_order
          ? a.sort_order - b.sort_order
          : a.route < b.route
            ? -1
            : 1,
    );

  // ── page_sections (route resolved from page_id, matching build-seed's shape) ──
  const sections = (
    await client.query(
      `SELECT pg.route AS route, ps.sort_order, ps.section_type, ps.variant,
              ps.content, ps.entity_refs, ps.asset_refs
         FROM page_sections ps
         JOIN pages pg ON pg.id = ps.page_id`,
    )
  ).rows
    .map((s) => ({
      route: s.route,
      sort_order: s.sort_order,
      section_type: s.section_type,
      variant: s.variant,
      content: s.content ?? {},
      entity_refs: s.entity_refs ?? [],
      asset_refs: s.asset_refs ?? [],
    }))
    .sort((a, b) =>
      a.route !== b.route ? (a.route < b.route ? -1 : 1) : a.sort_order - b.sort_order,
    );

  const redirects = (await client.query(`SELECT from_path, to_path, code FROM redirects`)).rows
    .map((r) => ({ from_path: r.from_path, to_path: r.to_path, code: r.code }))
    .sort(byKey('from_path'));

  const facts = (await client.query(`SELECT key, value FROM governance_facts`)).rows
    .map((f) => ({ key: f.key, value: f.value }))
    .sort(byKey('key'));

  write('entities.json', entities);
  write('pages.json', pages);
  write('page_sections.json', sections);
  write('redirects.json', redirects);
  write('governance_facts.json', facts);

  // ── _manifest.json (same gate contract as build-seed's manifest) ──
  const entityKeys = new Set(entities.map((e) => e.canonical_key));
  const danglingRefs = [];
  for (const s of sections)
    for (const ref of s.entity_refs) if (!entityKeys.has(ref)) danglingRefs.push({ route: s.route, ref });
  const routesWithBody = new Set(
    sections.filter((s) => s.section_type === 'page_content').map((s) => s.route),
  );
  const isFullyRendered = (p) => routesWithBody.has(p.route) || Boolean(p.seo && p.seo.description);
  const scaffoldOnly = pages.filter((p) => !isFullyRendered(p)).map((p) => p.route).sort();
  const byType = {};
  for (const e of entities) byType[e.entity_type] = (byType[e.entity_type] || 0) + 1;

  const gates = {
    dangling_entity_refs: danglingRefs.length,
    governance_facts_present: facts.length > 0,
  };
  const validation = gates.dangling_entity_refs === 0 && gates.governance_facts_present ? 'pass' : 'fail';

  write('_manifest.json', {
    bundle: 'cms-seed',
    schema_version: 'cms-seed/v1',
    source: 'jvto_cms (export-cms-seed)',
    generated_at: null, // stamped by caller/commit; kept null so DB-unchanged re-runs are byte-identical
    files: ['entities.json', 'pages.json', 'page_sections.json', 'redirects.json', 'governance_facts.json'],
    counts: {
      entities: entities.length,
      entities_by_type: byType,
      pages: pages.length,
      sections: sections.length,
      redirects: redirects.length,
      governance_facts: facts.length,
      routes_fully_rendered: pages.length - scaffoldOnly.length,
      routes_scaffold_only: scaffoldOnly.length,
    },
    routes_scaffold_only: scaffoldOnly,
    gates,
    validation,
  });

  console.log(
    `Exported jvto_cms → ${path.relative(root, OUT)}/: ${entities.length} entities, ${pages.length} pages, ` +
      `${sections.length} sections, ${redirects.length} redirects, ${facts.length} facts. validation=${validation}.`,
  );
  if (validation !== 'pass') {
    console.error('export-cms-seed: manifest validation FAILED', JSON.stringify(gates));
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
