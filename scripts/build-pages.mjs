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
    return byType.public_person_profile.filter((e) => (e.fields?.role?.value || '') === 'Crew').map((e) => e.canonicalKey);
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
    sections: gt.sections.map((s) => section(s, { selfKey: e.canonicalKey, destRefs })),
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
  },
  pages,
  redirects: cfg.redirects || [],
};
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(outDoc, null, 2) + '\n');
console.log(
  `Pages: ${pages.length} routes (${Object.entries(byGroup).map(([g, n]) => `${g}:${n}`).join(' ')}), ` +
    `${outDoc.counts.sections} sections, ${outDoc.counts.redirects} redirects, 0 dangling refs.`,
);
