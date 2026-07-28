// Build the PAGES / IA layer from config/pages.yaml + the entity projection.
//
// Marries the two stores: page composition (routes/order/grouping/sections from
// jvto-new-on-design-system, in config/pages.yaml) references content atoms
// (output/cms-projection/projection.json) by canonical_key. Tour + destination
// DETAIL pages are generated from the package/destination entities. Every
// entity_ref MUST resolve — the build fails on any dangling reference.
//
// Output: output/cms-projection/pages.json  { generatedAt, counts, pages, redirects }.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = process.cwd();
const OUT = path.join(root, 'output/cms-projection');
const GENERATED_AT = '2026-07-22T00:00:00.000Z';

const projection = JSON.parse(fs.readFileSync(path.join(OUT, 'projection.json'), 'utf8'));
const cfg = yaml.parse(fs.readFileSync(path.join(root, 'config/pages.yaml'), 'utf8'));

const byKey = new Map(projection.entities.map((e) => [e.canonicalKey, e]));
const byType = {};
for (const e of projection.entities) (byType[e.entityType] ||= []).push(e);

// token (from package.destination_tokens) → destination canonical_key (5 real dests).
const TOKEN_TO_DEST = {
  bromo: 'destination:mount-bromo', ijen: 'destination:kawah-ijen',
  madakaripura: 'destination:madakaripura', papuma: 'destination:papuma-beach',
  tumpak: 'destination:tumpak-sewu', sewu: 'destination:tumpak-sewu',
};
const pkgTokens = (e) => e.fields?.profile?.value?.destination_tokens || [];

const dangling = [];
function keep(refs) {
  const out = [];
  for (const r of refs || []) {
    if (byKey.has(r)) out.push(r);
    else dangling.push(r);
  }
  return [...new Set(out)];
}

function resolveRefQuery(q) {
  if (!q) return [];
  const [kind, arg] = q.split(':');
  if (kind === 'packages') {
    if (arg === 'all') return byType.package.map((e) => e.canonicalKey);
    const m = /^origin=(\w+)/.exec(arg);
    if (m) return byType.package.filter((e) => e.canonicalKey.startsWith(`package:${m[1]}-`)).map((e) => e.canonicalKey);
  }
  if (kind === 'destinations' && arg === 'real') return Object.values(TOKEN_TO_DEST).filter((v, i, a) => a.indexOf(v) === i);
  if (kind === 'faq') return byType.faq.map((e) => e.canonicalKey);
  if (kind === 'crew')
    // The operational crew = Guides + Drivers (the Founder and Medical Officer surface on
    // dedicated pages). No profile carries the literal role 'Crew', so match the real roles.
    return byType.public_person_profile
      .filter((e) => ['Guide', 'Driver'].includes(e.fields?.role?.value))
      .map((e) => e.canonicalKey);
  return [];
}

// Resolve a section spec → { type, variant, content, entity_refs } given optional self key + helpers.
function section(spec, ctx = {}) {
  let refs = [];
  if (spec.self && ctx.selfKey) refs.push(ctx.selfKey);
  if (spec.entity_refs) refs.push(...spec.entity_refs);
  if (spec.refs) refs.push(...spec.refs);
  if (spec.ref_query) refs.push(...resolveRefQuery(spec.ref_query));
  if (spec.refs_from === 'destination_tokens' && ctx.destRefs) refs.push(...ctx.destRefs);
  if (spec.refs_from === 'packages_with_destination' && ctx.pkgRefs) refs.push(...ctx.pkgRefs);
  if (spec.refs_from === 'itinerary_route' && ctx.routeRef) refs.push(...ctx.routeRef);
  return {
    type: spec.type,
    variant: spec.variant ?? null,
    content: spec.content ?? {},
    entity_refs: keep(refs),
  };
}

const pages = [];
const order = {}; // per-file_group running sort_order

function push(p) {
  const g = p.file_group;
  order[g] = (order[g] ?? 0) + 1;
  pages.push({ ...p, sort_order: order[g] });
}

// ── explicit pages ──
for (const p of cfg.pages) {
  const cluster = cfg.groups[p.file_group]?.cluster ?? null;
  push({
    route: p.route,
    file_group: p.file_group,
    cluster,
    page_type: p.page_type,
    template: p.template ?? null,
    visual_mode: p.visual_mode ?? null,
    hub_route: p.hub_route ?? null,
    title: p.title ?? null,
    h1: p.h1 ?? p.title ?? null,
    seo: { title: p.title ?? null },
    sections: (p.sections || []).map((s) => section(s)),
  });
}

// ── generated tour detail pages (one per package) ──
const gt = cfg.generate.tours;
for (const e of byType.package) {
  const key = e.canonicalKey.slice('package:'.length);
  const origin = key.startsWith('bali-') ? 'bali' : 'surabaya';
  const slug = key.slice(origin.length + 1);
  const destRefs = keep(pkgTokens(e).map((t) => TOKEN_TO_DEST[t]).filter(Boolean));
  // Fold the matching itinerary `route` entity (route_sequence / route_legs / dropoff) onto
  // this tour. The route key is the slug, with a `-bali` variant for Bali-origin tours;
  // keep() drops it if absent (no dangling), so a tour lacking a route just gets no ref.
  const routeRef = keep([`route:${slug}${origin === 'bali' ? '-bali' : ''}`]);
  push({
    route: `/tours/from-${origin}/${slug}`,
    file_group: gt.file_group,
    cluster: cfg.groups[gt.file_group].cluster,
    page_type: gt.page_type,
    template: gt.template,
    visual_mode: gt.visual_mode,
    hub_route: gt.hub_by_origin[origin],
    title: e.fields?.profile?.value?.title ?? e.title ?? slug,
    h1: e.fields?.profile?.value?.title ?? null,
    seo: { title: e.fields?.profile?.value?.title ?? null },
    sections: gt.sections.map((s) => section(s, { selfKey: e.canonicalKey, destRefs, routeRef })),
  });
}

// ── generated destination detail pages ──
const gd = cfg.generate.destinations;
for (const name of gd.only) {
  const selfKey = `destination:${name}`;
  if (!byKey.has(selfKey)) { dangling.push(selfKey); continue; }
  const token = gd.token_map[name];
  const isIjen = name === 'kawah-ijen';
  const pkgRefs = keep(byType.package.filter((p) => pkgTokens(p).some((t) => TOKEN_TO_DEST[t] === selfKey)).map((p) => p.canonicalKey));
  const secs = gd.sections
    .filter((s) => !(s.when_ijen && !isIjen))
    .map((s) => section(s, { selfKey, pkgRefs }));
  push({
    route: `/destinations/${token}`,
    file_group: gd.file_group,
    cluster: cfg.groups[gd.file_group].cluster,
    page_type: gd.page_type,
    template: gd.template,
    visual_mode: gd.visual_mode,
    hub_route: '/destinations',
    title: byKey.get(selfKey).fields?.name?.value ?? name,
    h1: byKey.get(selfKey).fields?.name?.value ?? null,
    seo: { title: byKey.get(selfKey).fields?.name?.value ?? null },
    sections: secs,
  });
}

// ── overlay real page copy: DESIGN-SYSTEM extract is the canonical source (jvto_dev
// out), carrying the full page copy losslessly as one `page_content` section so the
// SSOT actually HOLDS the real copy (not just {title} scaffolds). Deterministic: reads
// committed extracts, so re-runs reproduce byte-identical output.
//
// HYBRID override — three clusters render through structured contracts the prose
// design-system extract cannot satisfy, so they are sourced from the retained jvto-db
// extract WHERE it has a row (else they fall back to design-system):
//   • homepage `/`        — HomeHero reads a curated `h1` (not the source-doc title)
//   • `/why-jvto/*`       — renderer requires the `sections[]` block model, else 404
//   • `/travel-guide/*`   — renderer surfaces FAQ only from `content.faq`
// design-system-only routes in these clusters (e.g. new travel-guide pages) keep the
// design-system row; that is additive (body_md renders, just no FAQ), not a regression.
const dbPath = path.join(root, 'data/releases/design-system/content-pages.json');
const clusterPath = path.join(root, 'data/releases/jvto-db/content-pages.json');
// Prose routes whose design-system copy trips the founding-year facts lock: it asserts
// "PT … incorporated [2016]", contradicting jvto-web's locked "PT formal 2023". The
// 2016-vs-2023 PT-incorporation dispute (design-system/llm-wiki say 2016 AHU; jvto-web
// canon says 2023) is owner-locked and UNRESOLVED, so keep these on the facts-lock-clean
// jvto-db copy until adjudicated — do not silently rewrite the disputed year.
const FACTS_LOCK_FORCED = new Set(['/verify-jvto', '/verify-jvto/history-artifacts']);
const isStructuredCluster = (route) =>
  route === '/' ||
  route.startsWith('/why-jvto') ||
  route.startsWith('/travel-guide') ||
  FACTS_LOCK_FORCED.has(route);
// jvto-db uses long destination slugs; the SSOT IA uses short ones. Index those rows
// under the short route too, so a destination page can consume its rich jvto-db prose.
const ROUTE_ALIAS = {
  '/destinations/ijen-crater': '/destinations/ijen',
  '/destinations/madakaripura-waterfall': '/destinations/madakaripura',
  '/destinations/tumpak-sewu-waterfall': '/destinations/tumpak-sewu',
  '/destinations/papuma-beach': '/destinations/papuma',
};
// Content-richness score. A jvto-db row carries its copy as a structured contract
// (sections[]/faq); a design-system row as one body_md blob. Prefer the richer
// structured source, then longer prose. This is the A1 unification: the richest
// available copy wins per route, so jvto-db's rich tour/destination/FAQ rows stop
// going unused (previously a crude cluster hack picked design-system for them).
const richness = (row) => {
  if (!row) return -1;
  const c = row.content || {};
  const sec = Array.isArray(c.sections) ? c.sections.length : 0;
  const faq = Array.isArray(c.faq) ? c.faq.length : 0;
  const body = typeof c.body_md === 'string' ? c.body_md.length : 0;
  return sec * 1000 + faq * 500 + Math.floor(body / 50);
};
// A2 — per-field best-of merge. A page's copy can be split across extracts (design-system
// carries a body_md blob; jvto-db a structured sections[]/faq contract). Keep the richest
// base row, then additively adopt the longer PROSE body and any faq/sections[] the base
// lacks from the other extract, so no dimension is lost. Two safety gates keep the merge
// governance-clean: never adopt a display-schema stub as a body, and never adopt copy
// asserting the owner-locked-disputed PT-incorporation year "2016" (open since PR #7) or
// the retired "Travel Credit" term — so a merge can never reintroduce disputed content.
const isProse = (b) =>
  typeof b === 'string' && b.length > 0 && !/display schema only|page data structure/i.test(b.slice(0, 300));
const DISPUTED = /\b2016\b|travel credit/i;
const adoptableBody = (b) => isProse(b) && !DISPUTED.test(b);
const clean = (v) => !DISPUTED.test(JSON.stringify(v ?? ''));
function mergeContent(base, other) {
  const out = { ...base };
  if (adoptableBody(other.body_md) && other.body_md.length > (adoptableBody(out.body_md) ? out.body_md.length : 0)) {
    out.body_md = other.body_md;
  }
  if (!(Array.isArray(out.faq) && out.faq.length) && Array.isArray(other.faq) && other.faq.length && clean(other.faq)) {
    out.faq = other.faq;
  }
  if (!(Array.isArray(out.sections) && out.sections.length) && Array.isArray(other.sections) && other.sections.length && clean(other.sections)) {
    out.sections = other.sections;
  }
  return out;
}
const mergeSeo = (base, other) => {
  const out = {};
  for (const k of ['title', 'description', 'schema_type']) {
    const v = base[k] != null && base[k] !== '' ? base[k] : other[k];
    if (v) out[k] = v;
  }
  return out;
};
const overlay = { matched: 0, seo: 0, iaOnly: [], candidateNewUrls: [], clusterOverride: [], merged: 0 };
if (fs.existsSync(dbPath)) {
  const live = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const liveByRoute = new Map((live.rows || []).map((r) => [r.route, r]));
  const clusterDoc = fs.existsSync(clusterPath)
    ? JSON.parse(fs.readFileSync(clusterPath, 'utf8'))
    : { rows: [] };
  const clusterByRoute = new Map((clusterDoc.rows || []).map((r) => [r.route, r]));
  const clusterByAlias = new Map();
  for (const r of clusterDoc.rows || []) {
    const ia = ROUTE_ALIAS[r.route];
    if (ia) clusterByAlias.set(ia, r);
  }
  const consumedLive = new Set();
  for (const p of pages) {
    const liveRoute = p.route;
    const dsRow = liveByRoute.get(liveRoute);
    const dbRow = clusterByRoute.get(liveRoute) || clusterByAlias.get(liveRoute);
    let base, other;
    if (isStructuredCluster(liveRoute)) {
      // Contract-locked clusters (homepage curated h1, /why-jvto sections[], /travel-guide
      // faq, facts-lock-forced verify): jvto-db stays the base; design-system only enriches.
      base = dbRow || dsRow;
      other = base === dbRow ? dsRow : null;
      if (dbRow) overlay.clusterOverride.push(liveRoute);
    } else {
      // Richest row is the base (matched by route or destination alias); the other extract
      // enriches it per-field so rich jvto-db copy AND long design-system prose both land.
      if (richness(dbRow) > richness(dsRow)) { base = dbRow; other = dsRow; overlay.clusterOverride.push(liveRoute); }
      else { base = dsRow; other = dbRow; }
    }
    if (!base) { overlay.iaOnly.push(liveRoute); continue; }
    consumedLive.add(liveRoute);
    overlay.matched++;
    const baseContent = base.content || {};
    const lcontent = mergeContent(baseContent, other ? other.content || {} : {});
    if (other && JSON.stringify(lcontent) !== JSON.stringify(baseContent)) overlay.merged++;
    const lseo = mergeSeo(base.seo || {}, other ? other.seo || {} : {});
    p.seo = {
      ...(p.seo || {}),
      ...(lseo.title ? { title: lseo.title } : {}),
      ...(lseo.description ? { description: lseo.description } : {}),
      ...(lseo.schema_type ? { schema_type: lseo.schema_type } : {}),
    };
    if (lseo.description) overlay.seo++;
    if (lcontent.h1) p.h1 = lcontent.h1;
    // best-of real page copy (body_md/faq/lede/sections/…) merged into one section
    p.sections.push({
      type: 'page_content',
      variant: (lcontent.schema_version != null ? String(lcontent.schema_version) : 'live'),
      content: lcontent,
      entity_refs: [],
    });
  }
  // design-system routes with real copy but no SSOT page yet = candidate NEW SSOT URLs
  // (content-drives-URL: add them to the IA in a follow-on pass, don't force now).
  overlay.candidateNewUrls = (live.rows || []).map((r) => r.route).filter((r) => !consumedLive.has(r)).sort();
}

// RENDER-CONTRACT guard: /why-jvto/[slug] calls notFound() when its page_content lacks
// a non-empty sections[]. A prose-only (body_md) source here ships a live 404, so fail
// the build instead of emitting a seed that 404s (regression class fixed 2026-07-26).
const whyJvtoMissingSections = pages
  .filter((p) => p.route.startsWith('/why-jvto'))
  .filter((p) => {
    const pc = p.sections.find((s) => s.type === 'page_content');
    const secs = pc && pc.content && pc.content.sections;
    return !Array.isArray(secs) || secs.length === 0;
  })
  .map((p) => p.route);
if (whyJvtoMissingSections.length) {
  console.error(
    `RENDER-CONTRACT: /why-jvto/* route(s) missing sections[] (would 404 at runtime): ` +
      whyJvtoMissingSections.join(', '),
  );
  process.exit(1);
}

if (dangling.length) {
  console.error(`DANGLING entity_refs (${dangling.length}) — every ref must resolve:`);
  console.error([...new Set(dangling)].sort().join('\n'));
  process.exit(1);
}

pages.sort((a, b) => a.file_group.localeCompare(b.file_group) || a.sort_order - b.sort_order);
const byGroup = {};
for (const p of pages) byGroup[p.file_group] = (byGroup[p.file_group] || 0) + 1;

const outDoc = {
  generatedAt: GENERATED_AT,
  counts: {
    pages: pages.length,
    byGroup,
    sections: pages.reduce((n, p) => n + p.sections.length, 0),
    redirects: (cfg.redirects || []).length,
    liveOverlay: {
      matched: overlay.matched,
      mergedPerField: overlay.merged,
      withSeoDescription: overlay.seo,
      clusterOverride: overlay.clusterOverride,
      scaffoldOnly: overlay.iaOnly,
      candidateNewUrls: overlay.candidateNewUrls,
    },
  },
  pages,
  redirects: cfg.redirects || [],
};
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(outDoc, null, 2) + '\n');
console.log(
  `Pages: ${pages.length} routes (${Object.entries(byGroup).map(([g, n]) => `${g}:${n}`).join(' ')}), ` +
    `${outDoc.counts.sections} sections, ${outDoc.counts.redirects} redirects, 0 dangling refs.`,
);
console.log(
  `Content overlay (best-of per-field): ${overlay.matched} pages enriched (${overlay.seo} with real seo.description, ${overlay.merged} merged from both extracts); ` +
    `${overlay.clusterOverride.length} route(s) sourced from jvto-db [${overlay.clusterOverride.join(', ') || 'none'}]; ` +
    `${overlay.iaOnly.length} scaffold-only [${overlay.iaOnly.join(', ') || 'none'}]; ` +
    `${overlay.candidateNewUrls.length} extract routes with content but no SSOT page (candidate new URLs).`,
);
