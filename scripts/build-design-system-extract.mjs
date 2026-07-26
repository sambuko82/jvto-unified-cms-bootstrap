// Build the DESIGN-SYSTEM content extract that the build-pages overlay consumes.
//
// Replaces the retired jvto_dev extract (data/releases/jvto-db/content-pages.json)
// with page copy sourced ENTIRELY from `jvto-new-on-design-system` — so jvto_dev is
// out of the pipeline. Emits data/releases/design-system/content-pages.json in the
// exact shape build-pages.mjs reads: { rows: [ { route, seo, content } ] }.
//
// Sources (all under DESIGN_SYSTEM_PATH):
//   - uploads/*.md   → page prose (frontmatter `page:` maps to the SSOT route; a few
//                      destination/landing slugs are remapped to the short SSOT slug).
//   - products.json  → the 16 tour-detail bodies (canonical, IDR pricing).
//   - faq.json       → FAQ blocks attached by target_pages.
//   - uploads/{legal-licenses,police-integration,press-coverage}.md + verify-*.html
//                      → the 5 verify pages.
//
// PURE + DETERMINISTIC: no Date.now / Math.random; files read in sorted order; rows
// sorted by route; stable 2-space JSON + trailing newline. Re-runs are byte-identical.
import fs from 'node:fs';
import path from 'node:path';

const DS = process.env.DESIGN_SYSTEM_PATH || '/workspace/jvto-new-on-design-system';
const root = process.cwd();
const OUT_DIR = path.join(root, 'data/releases/design-system');
const OUT = path.join(OUT_DIR, 'content-pages.json');

const uploads = path.join(DS, 'uploads');
const readIf = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// ── design-system slug → SSOT route (the SSOT uses short destination slugs) ──
const ROUTE_ALIAS = {
  homepage: '/',
  'bali-landing': '/tours/from-bali',
  'surabaya-landing': '/tours/from-surabaya',
  '/destinations/ijen-crater': '/destinations/ijen',
  '/destinations/madakaripura-waterfall': '/destinations/madakaripura',
  '/destinations/tumpak-sewu-waterfall': '/destinations/tumpak-sewu',
  '/destinations/papuma-beach': '/destinations/papuma',
};
// md files that carry no frontmatter `page:` but map to a known SSOT route.
const FILE_ROUTE = {
  'mount-bromo.md': '/destinations/bromo',
};

function parseFrontmatter(rawIn) {
  // Returns { fm: {key:rawValue}, body }. Frontmatter is the block between the
  // first two `---` fences at the very top of the file. Strip a leading UTF-8 BOM
  // first — several source files carry one, which otherwise defeats the `---` test.
  const raw = rawIn.replace(/^\uFEFF/, '');
  if (!raw.startsWith('---')) return { fm: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s*\n/, '');
  const fm = {};
  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body };
}

function firstH1(body) {
  const m = body.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : undefined;
}

function metaDescription(body) {
  // Destination files embed `**Meta description:**` followed by the description line.
  const m = body.match(/\*\*Meta description:\*\*\s*\n+([^\n]+)/i);
  return m ? m[1].trim() : undefined;
}

function stripMd(s) {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function deriveDescription(body) {
  // First real prose paragraph (skip H1, HR, bold-metadata lines, blockquotes, lists),
  // stripped + truncated to ~155 chars at a word boundary. Deterministic SEO fallback.
  const paras = body.split(/\n\s*\n/);
  for (const p of paras) {
    const t = p.trim();
    if (!t || t.startsWith('#') || t.startsWith('---') || t.startsWith('>') || t.startsWith('- ') || t.startsWith('* ')) continue;
    if (/^\*\*[^*]+:\*\*/.test(t)) continue; // "**Issued by:** …" metadata lines
    const clean = stripMd(t);
    if (clean.length < 40) continue;
    if (clean.length <= 155) return clean;
    return clean.slice(0, 155).replace(/\s+\S*$/, '') + '…';
  }
  return undefined;
}

// ── collect rows keyed by SSOT route (first source wins; deterministic order) ──
const rowByRoute = new Map();
const addRow = (route, seo, content) => {
  if (!route || rowByRoute.has(route)) return; // first-wins keeps it deterministic
  const cleanSeo = {};
  if (seo?.title) cleanSeo.title = seo.title;
  const desc = seo?.description || (content?.body_md ? deriveDescription(content.body_md) : undefined);
  if (desc) cleanSeo.description = desc;
  if (seo?.schema_type) cleanSeo.schema_type = seo.schema_type;
  rowByRoute.set(route, { route, seo: cleanSeo, content });
};

// 1) Markdown page copy ------------------------------------------------------
const mdFiles = fs
  .readdirSync(uploads)
  .filter((f) => f.endsWith('.md'))
  .sort();
for (const f of mdFiles) {
  const raw = readIf(path.join(uploads, f));
  if (!raw) continue;
  const { fm, body } = parseFrontmatter(raw);
  let route = FILE_ROUTE[f] ?? (fm.page && fm.page !== 'None' ? fm.page : null);
  if (!route) continue; // wiki-source docs (page: None) are not page copy — skip
  route = ROUTE_ALIAS[route] ?? route;
  addRow(
    route,
    { description: metaDescription(body) },
    { h1: firstH1(body), body_md: body.trim(), schema_version: 'design-system' },
  );
}

// 2) Tour-detail bodies from products.json -----------------------------------
const products = JSON.parse(readIf(path.join(uploads, 'products.json')) || '{"packages":[]}');
const faqAll = JSON.parse(readIf(path.join(uploads, 'faq.json')) || '[]');
const faqList = Array.isArray(faqAll) ? faqAll : faqAll.faqs || faqAll.items || [];
const faqForRoute = (route) =>
  faqList
    .filter((q) => Array.isArray(q.target_pages) && q.target_pages.includes(route))
    .map((q) => ({ question: q.question, answer: q.answer }));

const idr = (n) => `IDR ${Number(n).toLocaleString('en-US')}`;
for (const pkg of (products.packages || []).slice().sort((a, b) => (a.url || '').localeCompare(b.url || ''))) {
  const route = pkg.url;
  // Only the real SSOT tour routes (from-bali / from-surabaya). Student + others
  // are emitted too if they are valid routes — the overlay only consumes the ones
  // that exist in the IA and logs the rest as candidate new URLs.
  if (!route || !route.startsWith('/tours/')) continue;
  const dests = Array.isArray(pkg.destinations)
    ? pkg.destinations.map((d) => (typeof d === 'string' ? d : d.name || d.token)).filter(Boolean)
    : [];
  const tiers = pkg.pricing?.tiers || [];
  const lines = [];
  lines.push(`# ${pkg.name}`);
  lines.push('');
  lines.push(
    `Private ${pkg.duration_days}D${pkg.duration_nights}N tour from ${pkg.origin}` +
      (dests.length ? `, covering ${dests.join(', ')}.` : '.'),
  );
  if (pkg.health_screening_required) {
    lines.push('');
    lines.push(
      'A medical health screening is mandatory for every guest before Kawah Ijen crater entry, per BBKSDA SE.1658/KSA.9/2024 — included in the price.',
    );
  }
  if (tiers.length) {
    lines.push('');
    lines.push('## Pricing (private, per person)');
    for (const t of tiers) {
      const span = t.pax_min === t.pax_max ? `${t.pax_min} pax` : `${t.pax_min}–${t.pax_max} pax`;
      lines.push(`- ${span}: ${idr(t.per_person)} per person`);
    }
  }
  addRow(
    route,
    { title: pkg.name },
    {
      h1: pkg.name,
      body_md: lines.join('\n'),
      faq: faqForRoute(route),
      schema_version: 'design-system',
    },
  );
}

// 2b) /tours hub — composed list of the from-* packages (no md source exists) ──
{
  const hub = (products.packages || [])
    .filter((p) => typeof p.url === 'string' && /^\/tours\/from-(bali|surabaya)\//.test(p.url))
    .sort((a, b) => a.url.localeCompare(b.url));
  if (hub.length) {
    const lines = ['# JVTO Private Volcano Tours', '', 'Choose a private, all-inclusive East Java volcano tour by starting point.', ''];
    for (const origin of ['Surabaya', 'Bali']) {
      const group = hub.filter((p) => (p.origin || '').toLowerCase().includes(origin.toLowerCase()));
      if (!group.length) continue;
      lines.push(`## From ${origin}`);
      for (const p of group) {
        const from = p.pricing?.tiers?.length
          ? ` — from ${idr(Math.min(...p.pricing.tiers.map((t) => t.per_person)))} per person`
          : '';
        lines.push(`- [${p.name}](${p.url})${from}`);
      }
      lines.push('');
    }
    addRow('/tours', { title: 'Private Volcano Tours' }, { h1: 'JVTO Private Volcano Tours', body_md: lines.join('\n').trim(), schema_version: 'design-system' });
  }
}

// 3) Verify pages ------------------------------------------------------------
function htmlToText(html) {
  if (!html) return '';
  let s = html;
  s = s.replace(/<head[\s\S]*?<\/head>/gi, '');
  s = s.replace(/<(script|style|nav|header|footer|svg)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<\/(p|div|section|li|h[1-6]|tr|br)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '- ');
  s = s.replace(/<h([1-6])[^>]*>/gi, (_, n) => '\n' + '#'.repeat(Number(n)) + ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trim()).join('\n');
  return s.trim();
}
const VERIFY = [
  { route: '/verify-jvto/legal', md: 'legal-licenses.md' },
  { route: '/verify-jvto/police-safety', md: 'police-integration.md' },
  { route: '/verify-jvto/press-recognition', md: 'press-coverage.md' },
  { route: '/verify-jvto', html: 'verify-jvto.html' },
  { route: '/verify-jvto/history-artifacts', html: 'verify-jvto-history-artifacts.html' },
];
for (const v of VERIFY) {
  let body;
  let h1;
  if (v.md) {
    const raw = readIf(path.join(uploads, v.md));
    if (raw) {
      const { body: b } = parseFrontmatter(raw);
      body = b.trim();
      h1 = firstH1(body);
    }
  } else if (v.html) {
    body = htmlToText(readIf(path.join(DS, v.html)));
    h1 = (body.match(/^#\s+(.+?)\s*$/m) || [])[1];
  }
  if (body) {
    addRow(v.route, {}, { h1, body_md: body, faq: faqForRoute(v.route), schema_version: 'design-system' });
  }
}

// ── write (rows sorted by route; stable) ──
const rows = [...rowByRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ source: 'jvto-new-on-design-system', rows }, null, 2) + '\n');
console.log(`Design-system extract → ${path.relative(root, OUT)}: ${rows.length} rows.`);
