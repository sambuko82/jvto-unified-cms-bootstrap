// Extract the STRUCTURED web-facing content from the llm-wiki knowledge base
// (the SSOT that jvto-web renders into help.javavolcano-touroperator.com) into the
// route-keyed page-copy shape the CMS overlay consumes.
//
// Two sources, one output:
//   1. output/website/pages/**/*.md — the authored PROSE pages (profile: website-copy).
//      Their markdown body IS the live page copy (verify-jvto/legal, travel-guide/*,
//      why-jvto/*, policy/*, mount-bromo, …). DB-spec pages (content_source: DB /
//      type: data-structure-spec — the 4 non-Bromo destinations + tour details) hold no
//      prose (their content is DB-driven) and are skipped here.
//   2. output/website/trust-bundle/destinations.json — the structured destination facts
//      (elevation, location, type, blue_fire, health_screening, entity_summary). Composed
//      into page copy for the DB-spec destinations so they carry the CORRECT facts
//      (Kawah Ijen 2,386 m — not the stale 2,769 m in the retired jvto-db mirror).
//
// Output: data/releases/llm-wiki-website/content-pages.json — same {route, seo, content}
// shape as the other overlay extracts, keyed by the CANONICAL (long) route slug
// (trust-bundle canonical_url / page frontmatter `page:`). Facts-lock sanitized on import
// (founding 2015 never 2016; Package Credit; Ijen screening mandatory framing).
//
// MANUAL snapshot step (like build-design-system-extract.mjs / scrape-help-live.mjs): reads
// the external llm-wiki checkout, writes a committed deterministic snapshot; NOT run in CI.
// Usage: `LLM_WIKI_PATH=/workspace/llm-wiki node scripts/build-llm-wiki-website-extract.mjs`.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = process.cwd();
const LLM_WIKI = process.env.LLM_WIKI_PATH || '/workspace/llm-wiki';
const WEBSITE = path.join(LLM_WIKI, 'output/website');
// jvto-itinerary-core supplies the RICH operational destination fields (trail, weather,
// attractions, gear, tips) that make a destination page live-depth — merged with the
// trust-bundle facts below. Optional: skipped if the checkout is absent.
const ITIN = process.env.ITINERARY_CORE_PATH || '/workspace/jvto-itinerary-core';
const OUT_DIR = path.join(root, 'data/releases/llm-wiki-website');
const GENERATED_AT = '2026-07-28T00:00:00.000Z'; // fixed: committed snapshot

// ── facts-lock sanitizer ──────────────────────────────────────────────────────
// Governance canon (governance/canonical-facts.json): founding 2015 (2016 is the
// owner-locked-disputed / "no invented incorporation date"); Package Credit (not Travel
// Credit); Ijen health screening framed as mandatory. Applied to every extracted string.
const factsLock = (s) => {
  if (typeof s !== 'string') return s;
  return s
    // retired cancellation wording → canonical
    .replace(/Lifetime Travel Credit/g, 'Lifetime Package Credit')
    .replace(/\bTravel Credit\b/g, 'Package Credit')
    // Ijen screening conditional phrasings → mandatory framing
    .replace(/when BBKSDA regulations require it/gi, 'mandatory for every guest before crater entry')
    // disputed PT-incorporation date (2016) — canon states NIB/TDUP era 2023, founding 2015,
    // "no invented incorporation date". Drop the invented incorporation date; keep NIB/TDUP.
    .replace(/\b2016-01-01\b/g, '—')
    .replace(/\bincorporated\b([^.]*?)\b2016\b/gi, 'formalised$1 2023')
    // any remaining founding-context 2016 → the canonical founding year 2015
    .replace(/\b(founded|since|established|est\.?|EST)\s+2016\b/gi, '$1 2015')
    .replace(/\bin\s+2016\b/gi, 'in 2015');
};
const sanitize = (o) =>
  typeof o === 'string'
    ? factsLock(o)
    : Array.isArray(o)
      ? o.map(sanitize)
      : o && typeof o === 'object'
        ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sanitize(v)]))
        : o;

// ── frontmatter split (tolerate a BOM) ────────────────────────────────────────
function parseDoc(raw) {
  const text = raw.replace(/^﻿/, '');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  let fm = {};
  try {
    fm = yaml.parse(m[1]) || {};
  } catch {
    fm = {};
  }
  return { fm, body: m[2] };
}

const isDbSpec = (fm) =>
  fm.content_source === 'DB' || fm.type === 'data-structure-spec';

const firstH1 = (body) => (body.match(/^#\s+(.+?)\s*$/m) || [, ''])[1].trim();
const metaDesc = (body) => {
  const m = body.match(/\*\*Meta description:\*\*\s*\r?\n?\s*(.+?)\s*(?:\r?\n\r?\n|\r?\n#|$)/s);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
};

// ── 1) PROSE pages → route-keyed body_md ──────────────────────────────────────
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

function extractProse() {
  const pagesDir = path.join(WEBSITE, 'pages');
  const rows = [];
  for (const file of walk(pagesDir)) {
    const { fm, body } = parseDoc(fs.readFileSync(file, 'utf8'));
    const route = typeof fm.page === 'string' ? fm.page.trim() : null;
    if (!route || !route.startsWith('/')) continue; // need an explicit canonical route
    if (isDbSpec(fm)) continue; // DB-driven spec, no prose to extract
    const h1 = firstH1(body);
    if (!h1) continue;
    rows.push({
      route,
      lang: 'en',
      seo: { title: h1, description: metaDesc(body) },
      content: { h1, body_md: body.trim(), source: `llm-wiki:pages${route}` },
    });
  }
  return rows;
}

// ── 2) DESTINATIONS → composed body_md from the structured trust-bundle ────────
function fmtElevation(v) {
  if (typeof v === 'number') return `${v.toLocaleString('en-US')} m`;
  if (v && typeof v === 'object') {
    // e.g. papuma { beach: 0, cape_headland: 86 }
    const parts = Object.entries(v)
      .filter(([, n]) => typeof n === 'number' && n > 0)
      .map(([k, n]) => `${n} m (${k.replace(/_/g, ' ')})`);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

// Match a trust-bundle destination id → its itinerary-core master (by name keyword).
const DEST_KEYWORD = {
  'kawah-ijen': 'ijen', 'mount-bromo': 'bromo', 'madakaripura': 'madakaripura',
  'tumpak-sewu': 'tumpak', 'papuma-beach': 'papuma',
};
function loadItineraryMasters() {
  const p = path.join(ITIN, 'generated/itinerary-intelligence/22-destinations-master.json');
  if (!fs.existsSync(p)) return [];
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(d) ? d : d.destinations || Object.values(d).find(Array.isArray) || [];
}
const masterFor = (id, masters) => {
  const kw = DEST_KEYWORD[id];
  return kw ? masters.find((m) => String(m.name || '').toLowerCase().includes(kw)) || null : null;
};

function composeDestination(d, m) {
  const kf = d.key_facts || {};
  const facts = [];
  const elev = fmtElevation(d.elevation_m);
  if (elev) facts.push(`- **Elevation:** ${elev}`);
  if (d.location) facts.push(`- **Location:** ${d.location}`);
  if (d.type) facts.push(`- **Type:** ${d.type}`);
  if (m && m.difficulty_level) facts.push(`- **Difficulty:** ${m.difficulty_level}`);
  if (kf.best_season) facts.push(`- **Best season:** ${kf.best_season}`);
  if (kf.access) facts.push(`- **Access:** ${kf.access}`);
  if (kf.crater_lake) facts.push(`- **Crater lake:** ${kf.crater_lake}`);
  if (kf.famous_for) facts.push(`- **Famous for:** ${kf.famous_for}`);
  if (kf.regulatory_authority) facts.push(`- **Regulatory authority:** ${kf.regulatory_authority}`);

  const parts = [`# ${d.name}`, ''];
  if (d.entity_summary) parts.push('**Meta description:**', d.entity_summary, '');
  parts.push('## Overview', [d.entity_summary, m && m.description].filter(Boolean).join('\n\n'), '');
  if (facts.length) parts.push('## Quick Facts', ...facts, '');
  if (m && (m.best_time_to_visit || m.weather_by_season)) {
    parts.push('## Best Time to Visit', [m.best_time_to_visit, m.weather_by_season].filter(Boolean).join('\n\n'), '');
  }
  if (m && (m.trail_details || m.physical_requirements)) {
    parts.push('## The Trail', [m.trail_details, m.physical_requirements].filter(Boolean).join('\n\n'), '');
  }
  if (m && m.main_attractions) parts.push('## What to See', m.main_attractions, '');
  if (d.blue_fire && d.blue_fire.approved_language) {
    parts.push('## The Blue Fire', d.blue_fire.approved_language, '');
  }
  if (d.ijen_relevant && d.health_screening) {
    const reg = d.health_screening.regulation ? ` per ${d.health_screening.regulation}` : '';
    parts.push(
      '## Health Certificate Coordination',
      `A health certificate is mandatory for every guest before Kawah Ijen crater entry${reg}. JVTO coordinates the mandatory clinic workflow. See the full protocol at [Ijen Health Screening](/travel-guide/ijen-health-screening).`,
      '',
    );
  }
  if (m && (m.required_gear || m.tips_for_visitors)) {
    const g = [];
    if (m.required_gear) g.push(`**Gear:** ${m.required_gear}`);
    if (m.tips_for_visitors) g.push(`**Tips:** ${m.tips_for_visitors}`);
    parts.push('## Gear & Tips', g.join('\n\n'), '');
  }
  const body_md = parts.join('\n').trim();
  return {
    route: d.canonical_url,
    lang: 'en',
    seo: {
      title: `${d.name} — East Java | JVTO`,
      description: (d.entity_summary || '').replace(/\s+/g, ' ').slice(0, 155),
    },
    content: { h1: d.name, body_md, elevation_m: d.elevation_m, source: `llm-wiki:trust-bundle/destinations#${d.id}` },
  };
}

function extractDestinations(proseRoutes) {
  const p = path.join(WEBSITE, 'trust-bundle/destinations.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.destinations || Object.values(raw);
  const masters = loadItineraryMasters();
  const rows = [];
  for (const d of list) {
    if (!d || !d.canonical_url) continue;
    if (proseRoutes.has(d.canonical_url)) continue; // authored prose (mount-bromo) wins
    rows.push(composeDestination(d, masterFor(d.id, masters)));
  }
  return rows;
}

function main() {
  if (!fs.existsSync(WEBSITE)) {
    console.error(`llm-wiki website output not found at ${WEBSITE} (set LLM_WIKI_PATH). Skipping.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const prose = extractProse();
  const proseRoutes = new Set(prose.map((r) => r.route));
  const dests = extractDestinations(proseRoutes);
  const rows = sanitize([...prose, ...dests]).sort((a, b) => a.route.localeCompare(b.route));
  const doc = { generatedAt: GENERATED_AT, source: 'llm-wiki/output/website', count: rows.length, rows };
  fs.writeFileSync(path.join(OUT_DIR, 'content-pages.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(
    `llm-wiki-website extract: ${rows.length} routes (${prose.length} prose + ${dests.length} composed destinations) → data/releases/llm-wiki-website/content-pages.json`,
  );
}

main();
