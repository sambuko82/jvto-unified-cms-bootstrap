// scripts/build-asset-extract.mjs
// Extract the JVTO SSOT image inventory (llm-wiki/raw/jvto_image_asset_map.json — 54
// curated images with alt text, grouped, each traced to a source DB field) into the
// route/entity-linked asset shape the CMS seed + the jvto_dev sync consume.
//
// Output: data/releases/assets/assets.json — committed deterministic snapshot, same
// MANUAL-extract pattern as build-design-system-extract.mjs / build-llm-wiki-website-extract.mjs
// (reads an external checkout, not run in CI, output committed).
//
// Usage: LLM_WIKI_PATH=/workspace/llm-wiki node scripts/build-asset-extract.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const LLM_WIKI = process.env.LLM_WIKI_PATH || '/workspace/llm-wiki';
const MAP = path.join(LLM_WIKI, 'raw/jvto_image_asset_map.json');
const OUT_DIR = path.join(root, 'data/releases/assets');
const GENERATED_AT = '2026-07-28T00:00:00.000Z'; // fixed: committed snapshot

const slug = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Known crew route slugs (config/pages.yaml generate.team) — used to link crew photos.
const CREW_SLUGS = ['anjas', 'boy', 'fauzi', 'fredi', 'gufron', 'holili', 'joyo', 'kiki', 'rendi', 'taufik', 'yandi'];

// Map an image's `source` DB-field trace + group → a best-effort CMS link.
// { type:'org'|'destination'|'package'|'page'|'entity'|null, ref }
function inferLink(a) {
  const src = String(a.source || '').toLowerCase();
  const grp = String(a.group || '').toLowerCase();
  const hay = `${a.title || ''} ${src}`.toLowerCase();

  if (src.startsWith('organization.') || grp === 'brand_identity') {
    // org branding — hero vs logo distinguished by the source field / filename
    const field = /logo/.test(hay) ? 'logo_url' : /hero/.test(hay) ? 'hero_image_url' : null;
    return { type: 'org', ref: 'organization_profile', field };
  }
  if (grp.startsWith('crew') || /crew_registry|guide|driver/.test(src)) {
    const found = CREW_SLUGS.find((s) => hay.includes(s));
    return { type: found ? 'page' : 'entity', ref: found ? `/team/${found}` : 'public_person_profile' };
  }
  if (/founder|leadership/.test(grp)) return { type: 'page', ref: '/why-jvto/our-story' };
  if (/legal|police|membership|tourism_license|business_identity/.test(grp))
    return { type: 'page', ref: '/verify-jvto/legal' };
  if (/health_screening/.test(grp)) return { type: 'page', ref: '/travel-guide/ijen-health-screening' };
  if (/press|mentions/.test(grp)) return { type: 'page', ref: '/verify-jvto/press-recognition' };
  if (/history|heritage/.test(grp)) return { type: 'page', ref: '/verify-jvto/history-artifacts' };
  if (/partner/.test(grp)) return { type: 'page', ref: '/verify-jvto/legal' };
  // field_operations & uncertain → sitewide/homepage
  return { type: 'page', ref: '/' };
}

function main() {
  if (!fs.existsSync(MAP)) {
    console.error(`image asset map not found at ${MAP} (set LLM_WIKI_PATH). Skipping.`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const groups = doc.groups || {};
  const rows = [];
  const seen = new Set();
  for (const [groupKey, items] of Object.entries(groups)) {
    for (const a of Array.isArray(items) ? items : []) {
      if (!a || !a.url) continue;
      const key = (a.recommended_filename && a.recommended_filename.trim())
        || `${groupKey}/${slug(a.title) || slug(a.url)}`;
      if (seen.has(key)) continue; // stable, de-duped
      seen.add(key);
      const link = inferLink({ ...a, group: a.group || groupKey });
      rows.push({
        key,
        url: a.url,
        title: a.title || null,
        alt: a.alt_text || null,
        caption: a.caption || null,
        kind: 'image',
        group: a.group || groupKey,
        source_field: a.source || null,
        source_category: a.source_category || null,
        recommended_pages: Array.isArray(a.recommended_pages) ? a.recommended_pages : [],
        link,
      });
    }
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generatedAt: GENERATED_AT,
    source: 'llm-wiki/raw/jvto_image_asset_map.json',
    count: rows.length,
    rows,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'assets.json'), JSON.stringify(out, null, 2) + '\n');
  const byLink = rows.reduce((m, r) => ((m[r.link.type] = (m[r.link.type] || 0) + 1), m), {});
  console.log(
    `asset extract: ${rows.length} images → data/releases/assets/assets.json ` +
      `(links: ${JSON.stringify(byLink)})`,
  );
}

main();
