// Pull real page content from the live jvto_dev DB (read-only) to enrich the CMS
// core: organization_profile (org facts) + content_pages (per-route seo + body_md
// + faq). Writes data/releases/jvto-db/{organization_profile.json, content-pages.json}.
// The seed builder (build-seed.mjs) then overlays this real copy onto pages by
// exact route match.
//
// Connection: DATABASE_URL from the environment (gitignored .env / shell) — NEVER
// hardcode credentials here. READ-ONLY: this script only SELECTs; it never writes
// to jvto_dev. Requires the `pg` package + direct :5432 reachability (available in
// the new workspace / production; this sandbox blocks :5432, where the route
// inventory in data/releases/jvto-db/content-pages-routes.json was captured via
// Adminer instead).
//
//   DATABASE_URL=postgresql://.../jvto_dev  node scripts/pull-db.mjs
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set. Read-only pull requires it (never hardcode creds).');
  process.exit(2);
}

const OUT = path.join(process.cwd(), 'data/releases/jvto-db');
fs.mkdirSync(OUT, { recursive: true });

// Facts-lock sanitizer (canonical-facts wins; correct retired wording on import).
function factsLock(v) {
  if (typeof v !== 'string') return v;
  return v
    .replace(/when BBKSDA regulations require it/gi, 'mandatory for every guest before crater entry')
    .replace(/Lifetime Travel Credit/g, 'Lifetime Package Credit')
    .replace(/\bTravel Credit\b/g, 'Package Credit');
}
function sanitize(obj) {
  if (typeof obj === 'string') return factsLock(obj);
  if (Array.isArray(obj)) return obj.map(sanitize);
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(obj)) o[k] = sanitize(v);
    return o;
  }
  return obj;
}

async function main() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const org = await client.query('SELECT * FROM organization_profile LIMIT 1');
    fs.writeFileSync(
      path.join(OUT, 'organization_profile.json'),
      JSON.stringify(sanitize(org.rows[0] ?? null), null, 2) + '\n',
    );

    const cp = await client.query(
      "SELECT route, lang, seo, content, is_active FROM content_pages WHERE is_active IS DISTINCT FROM false ORDER BY route",
    );
    const rows = cp.rows.map((r) => ({
      route: r.route,
      lang: r.lang,
      seo: sanitize(r.seo),
      content: sanitize(r.content),
    }));
    fs.writeFileSync(
      path.join(OUT, 'content-pages.json'),
      JSON.stringify({ pulledAt: new Date().toISOString().slice(0, 10), count: rows.length, rows }, null, 2) + '\n',
    );
    console.log(`Pulled org_profile + ${rows.length} content_pages (read-only, facts-lock sanitized) → data/releases/jvto-db/`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('pull-db failed:', e.message);
  process.exit(1);
});
