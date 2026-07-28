// Scrape the live public site (help.javavolcano-touroperator.com) for the pages whose
// copy is HARDCODED in jvto-web and therefore absent from the DB `content_pages` mirror
// (jvto-db extract) — /markets/*, /trust, and the live blog posts. The site is Next.js
// App Router, fully server-rendered, so the visible copy is in the raw HTML.
//
// Output: data/releases/help-live/content-pages.json — the SAME route-keyed shape as the
// jvto-db extract ({route, seo, content:{h1, lede, sections[], faq[]}}), facts-lock
// sanitized on import, so build-pages.mjs overlays it by route with zero new merge logic.
//
// This is a MANUAL snapshot step (like scripts/pull-db.mjs), NOT part of verify:projection —
// build-pages reads the committed snapshot, so the pipeline stays deterministic. Re-run to
// refresh. Usage: `node scripts/scrape-help-live.mjs` (network) or with SCRAPE_FIXTURE_DIR
// pointing at saved *.html for an offline/deterministic re-run.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const OUT = path.join(root, 'data/releases/help-live');
const BASE = 'https://help.javavolcano-touroperator.com';
const SCRAPED_AT = '2026-07-28T00:00:00.000Z'; // fixed: this file is a committed snapshot

const ROUTES = [
  '/markets/singapore',
  '/markets/malaysia',
  '/trust',
  '/blog/2026-06-11-kawah-ijen-guide',
  '/blog/2026-06-11-ijen-medical-checkup-requirement',
];

// ── facts-lock sanitizer (mirrors scripts/pull-db.mjs: canonical wording wins) ──
const factsLock = (s) =>
  typeof s !== 'string'
    ? s
    : s
        .replace(/when BBKSDA regulations require it/gi, 'mandatory for every guest before crater entry')
        .replace(/Lifetime Travel Credit/g, 'Lifetime Package Credit')
        .replace(/\bTravel Credit\b/g, 'Package Credit');
const sanitize = (o) =>
  typeof o === 'string'
    ? factsLock(o)
    : Array.isArray(o)
      ? o.map(sanitize)
      : o && typeof o === 'object'
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sanitize(v)]))
        : o;

// ── minimal HTML helpers (server-rendered pages → regex is sufficient + dependency-free) ──
const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#(?:39|x27);/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Strip only INLINE chrome. Keep <header>/<footer>: the page title <h1> lives in a
// semantic article <header> inside <main>, and site header/footer sit OUTSIDE <main>
// (excluded by the <main> extraction), so they never pollute the parsed content.
const stripInline = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '');

// noise a <p> shouldn't become a content paragraph
const isNoise = (t) =>
  !t ||
  t.length < 2 ||
  /@context|schema\.org|^\{|window\.|function\(/.test(t) ||
  /^(Tours|By Location|Popular|WhatsApp|Menu|Home)$/i.test(t);

const metaTitle = (h) => decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1]);
const metaDesc = (h) =>
  ((h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [, ''])[1] || '').trim();
const schemaType = (h) => {
  const m = h.match(/"@type"\s*:\s*"(Article|BlogPosting|WebPage|CollectionPage|FAQPage|ProfilePage|TravelAgency)"/);
  return m ? m[1] : undefined;
};

/** Parse the main content region into { h1, lede, sections[], faq[] }. */
function parseContent(html, route) {
  // Content lives inside <main> (some pages have more than one main region — e.g. blog
  // posts split header + body); concatenate them, then strip inline chrome only.
  const mains = [...html.matchAll(/<main[\s\S]*?<\/main>/gi)].map((m) => m[0]);
  const region = stripInline(mains.length ? mains.join('\n') : html);

  // ordered h1/h2/h3/p blocks
  const blocks = [];
  const re = /<(h1|h2|h3|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(region))) {
    const tag = m[1].toLowerCase();
    const text = decode(m[2]);
    if (tag === 'p' && isNoise(text)) continue;
    if (text) blocks.push({ tag, text });
  }

  // start at the first h1; drop leading nav/crumb <p>s before it
  const h1i = blocks.findIndex((b) => b.tag === 'h1');
  const h1 = h1i >= 0 ? blocks[h1i].text : '';
  const rest = h1i >= 0 ? blocks.slice(h1i + 1) : blocks;

  // lede = paragraphs before the first heading
  const firstHeading = rest.findIndex((b) => b.tag === 'h2' || b.tag === 'h3');
  const lede = (firstHeading >= 0 ? rest.slice(0, firstHeading) : rest.slice(0, 2))
    .filter((b) => b.tag === 'p')
    .map((b) => b.text);

  // group the remaining blocks under their h2/h3; a heading whose text reads like an
  // FAQ prompt collects its following <p> pairs as Q/A instead of prose.
  const sections = [];
  const faq = [];
  let cur = null;
  let faqMode = false;
  for (const b of firstHeading >= 0 ? rest.slice(firstHeading) : []) {
    if (b.tag === 'h2' || b.tag === 'h3') {
      faqMode = /question|faq|ask|answer|quick answers/i.test(b.text);
      if (!faqMode) {
        cur = { title: b.text, body: [] };
        sections.push(cur);
      } else {
        cur = null;
      }
      continue;
    }
    // b.tag === 'p'
    if (faqMode) {
      const last = faq[faq.length - 1];
      if (!last || last.a) faq.push({ q: b.text, a: '' });
      else last.a = b.text;
    } else if (cur) {
      cur.body.push(b.text);
    }
  }

  return {
    h1,
    lede,
    sections: sections
      .map((s) => ({ title: s.title, body: s.body.join('\n\n') }))
      .filter((s) => s.body),
    faq: faq.filter((f) => f.q && f.a),
    source: `scraped:${BASE}${route}`,
    scraped_at: SCRAPED_AT,
  };
}

async function fetchHtml(route) {
  const fixtureDir = process.env.SCRAPE_FIXTURE_DIR;
  if (fixtureDir) {
    const f = path.join(fixtureDir, route.replace(/\//g, '_').replace(/^_/, '') + '.html');
    return fs.readFileSync(f, 'utf8');
  }
  const res = await fetch(`${BASE}${route}`, { headers: { 'user-agent': 'jvto-cms-migration/1.0' } });
  if (!res.ok) throw new Error(`${route} -> HTTP ${res.status}`);
  return res.text();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const rows = [];
  for (const route of ROUTES) {
    const html = await fetchHtml(route);
    const content = parseContent(html, route);
    if (!content.h1) {
      console.error(`WARN ${route}: no <h1> parsed — skipping`);
      continue;
    }
    rows.push(
      sanitize({
        route,
        lang: 'en',
        seo: { title: metaTitle(html), description: metaDesc(html), schema_type: schemaType(html) },
        content,
      }),
    );
    console.log(
      `  ${route}: h1="${content.h1.slice(0, 50)}" sections=${content.sections.length} faq=${content.faq.length}`,
    );
  }
  rows.sort((a, b) => a.route.localeCompare(b.route));
  const doc = { scrapedAt: SCRAPED_AT, source: BASE, count: rows.length, rows };
  fs.writeFileSync(path.join(OUT, 'content-pages.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(`Scraped ${rows.length} live pages (facts-lock sanitized) → data/releases/help-live/content-pages.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
