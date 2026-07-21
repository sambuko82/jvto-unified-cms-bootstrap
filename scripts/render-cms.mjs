// Render the consolidated projection (output/cms-projection/projection.json) into
// ONE self-contained, browsable static CMS catalog: output/cms-projection/index.html.
//
// This is the DB-free, live-free "CMS" the owner opens directly in a browser —
// no server, no database, no auth, no JS runtime. It groups every projected
// canonical entity by its visual-mode cluster -> entity type -> entity, and for
// each field shows the value, its owning source, and its field-ownership
// write-policy badge (ported from the previous CMS's POLICY_BADGE semantics),
// plus provenance (release version + source freshness). Read-only by design: a
// build artifact, not a runtime (ADR-007).
//
// Deterministic (fixed generatedAt from the projection) so the committed HTML is
// drift-guarded in CI.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

const root = process.cwd();
const OUT_DIR = path.join(root, 'output/cms-projection');
const projection = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'projection.json'), 'utf8'));
const ownership = yaml.parse(fs.readFileSync(path.join(root, 'config/field-ownership.yaml'), 'utf8'));
const registry = yaml.parse(fs.readFileSync(path.join(root, 'config/source-registry.yaml'), 'utf8'));
const relIndex = JSON.parse(fs.readFileSync(path.join(root, 'data/releases/_index.json'), 'utf8'));

// entity_type -> visual-mode cluster (the taxonomy grouping; ports the proven
// cluster split from jvto-web's entityRegistry onto the bootstrap's 22 types).
const CLUSTER_OF = {
  page: 'content', asset: 'content', component: 'content', design_system_version: 'content',
  site_identity: 'content', source_release: 'content',
  package: 'travel', destination: 'travel', route: 'travel', activity: 'travel',
  hotel: 'travel', vehicle_type: 'travel',
  claim: 'trust', evidence: 'trust', proof_group: 'trust', policy_document: 'trust',
  policy_rule: 'trust', review: 'trust', public_person_profile: 'trust', crew_member: 'trust',
  faq: 'hybrid', general_module: 'hybrid', support_topic: 'hybrid',
};
const CLUSTER_ORDER = ['content', 'travel', 'trust', 'hybrid'];
const CLUSTER_META = {
  content: { label: 'Content & System', purpose: 'page copy, identity, media, consolidation' },
  travel: { label: 'Travel', purpose: 'discovery, routes, destinations & products' },
  trust: { label: 'Trust & Proof', purpose: 'canonical proof, people and formal rules' },
  hybrid: { label: 'Support & Narrative', purpose: 'operational support and reusable knowledge' },
};

// write-policy -> badge (label + color), ported from the previous CMS POLICY_BADGE.
const POLICY = {
  editable: { label: 'Editable', color: '#34d399', bg: 'rgba(16,185,129,.12)' },
  read_only: { label: 'Synced · read-only', color: '#38bdf8', bg: 'rgba(14,165,233,.12)' },
  operational_only: { label: 'Operational', color: '#fbbf24', bg: 'rgba(245,158,11,.12)' },
  compliance_only: { label: 'Facts-locked', color: '#fb7185', bg: 'rgba(244,63,94,.12)' },
  override_with_approval: { label: 'Override w/ approval', color: '#c084fc', bg: 'rgba(168,85,247,.12)' },
  developer_only: { label: 'Developer-only', color: '#94a3b8', bg: 'rgba(148,163,184,.12)' },
  context: { label: 'Source context', color: '#64748b', bg: 'rgba(100,116,139,.10)' },
};

// Resolve a field's ownership rule: exact entity::field, else entity::* wildcard.
function fieldPolicy(entityType, field) {
  const rules = ownership.rules;
  const exact = rules.find((r) => r.entity_type === entityType && r.field_path === field);
  const wild = rules.find((r) => r.entity_type === entityType && r.field_path === '*');
  const rule = exact || wild;
  return rule ? { owner: rule.owner_source, policy: rule.write_policy } : { owner: null, policy: 'context' };
}

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderValue(v) {
  if (v == null) return '<span class="muted">—</span>';
  if (typeof v === 'string') return esc(v.length > 600 ? v.slice(0, 600) + ' …' : v);
  if (typeof v === 'number' || typeof v === 'boolean') return esc(String(v));
  const json = JSON.stringify(v, null, 2);
  return `<pre>${esc(json.length > 4000 ? json.slice(0, 4000) + '\n…' : json)}</pre>`;
}

function badge(policy) {
  const p = POLICY[policy] || POLICY.context;
  return `<span class="badge" style="color:${p.color};background:${p.bg};border-color:${p.color}55">${esc(p.label)}</span>`;
}

// ---- group entities by cluster -> type ----
const byCluster = {};
for (const c of CLUSTER_ORDER) byCluster[c] = {};
for (const e of projection.entities) {
  const cluster = CLUSTER_OF[e.entityType] || 'content';
  (byCluster[cluster][e.entityType] ||= []).push(e);
}

const titleOf = (e) => {
  const f = e.fields;
  const pick = (k) => (typeof f[k]?.value === 'string' ? f[k].value : null);
  return (
    pick('name') || pick('title') || pick('question') || pick('canonical_wording') ||
    (f.profile?.value?.title) || (f.content?.value?.h1) || e.canonicalKey.split(':').slice(1).join(':')
  );
};

function entityCard(e) {
  const sources = [...new Set(Object.values(e.fields).map((f) => f.source))].sort();
  const rows = Object.entries(e.fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, { value, source }]) => {
      const { owner, policy } = fieldPolicy(e.entityType, field);
      const own = owner || source;
      return `<tr><td class="fld">${esc(field)}</td><td class="val">${renderValue(value)}</td>
        <td class="src">${esc(own)}</td><td>${badge(policy)}</td></tr>`;
    })
    .join('\n');
  return `<details class="entity">
    <summary><span class="etitle">${esc(titleOf(e))}</span>
      <code class="ekey">${esc(e.canonicalKey)}</code>
      ${e.route ? `<span class="route">${esc(e.route)}</span>` : ''}
      <span class="esrc">${esc(sources.join(' · '))}</span></summary>
    <table class="fields"><thead><tr><th>field</th><th>value</th><th>owner source</th><th>policy</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </details>`;
}

const legend = Object.entries(POLICY)
  .map(([k]) => badge(k))
  .join(' ');

const sourceMeta = relIndex.sources
  .map((s) => `<span class="chip">${esc(s.source)} · ${s.records}</span>`)
  .join(' ');

const clusterSections = CLUSTER_ORDER.map((c) => {
  const types = byCluster[c];
  const typeKeys = Object.keys(types).sort();
  if (!typeKeys.length) return '';
  const typeBlocks = typeKeys
    .map((t) => {
      const list = types[t].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
      const owner = fieldPolicy(t, '*').owner || fieldPolicy(t, Object.keys(list[0].fields)[0]).owner || '—';
      return `<div class="etype"><h3>${esc(t)} <span class="count">${list.length}</span>
        <span class="owner">owner: ${esc(owner)}</span></h3>
        ${list.map(entityCard).join('\n')}</div>`;
    })
    .join('\n');
  const total = typeKeys.reduce((n, t) => n + types[t].length, 0);
  return `<section class="cluster"><h2>${esc(CLUSTER_META[c].label)} <span class="count">${total}</span></h2>
    <p class="purpose">${esc(CLUSTER_META[c].purpose)}</p>${typeBlocks}</section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>JVTO Unified CMS — Static Projection</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    background:#0b1120; color:#e2e8f0; }
  header { padding:24px 20px; border-bottom:1px solid #1e293b; background:#0f172a; position:sticky; top:0; z-index:5; }
  header h1 { margin:0 0 4px; font-size:20px; color:#f8fafc; }
  header .sub { color:#94a3b8; font-size:12px; }
  .meta { margin-top:10px; display:flex; flex-wrap:wrap; gap:6px; }
  .chip { font-size:11px; padding:2px 8px; border:1px solid #334155; border-radius:999px; color:#cbd5e1; background:#0b1120; }
  .legend { margin-top:10px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
  main { padding:20px; max-width:1100px; margin:0 auto; }
  .cluster { margin-bottom:32px; }
  .cluster > h2 { font-size:16px; color:#f1f5f9; border-bottom:1px solid #1e293b; padding-bottom:6px; text-transform:uppercase; letter-spacing:.08em; }
  .purpose { color:#64748b; font-size:12px; margin:4px 0 14px; }
  .etype { margin:0 0 18px; }
  .etype h3 { font-size:13px; color:#cbd5e1; margin:0 0 8px; font-family:ui-monospace,monospace; }
  .count { display:inline-block; background:#1e293b; color:#93c5fd; border-radius:999px; padding:0 8px; font-size:11px; margin-left:6px; }
  .owner { color:#64748b; font-size:11px; font-family:inherit; margin-left:8px; }
  details.entity { border:1px solid #1e293b; border-radius:10px; margin:6px 0; background:#0f172a; overflow:hidden; }
  details.entity[open] { border-color:#334155; }
  summary { cursor:pointer; padding:9px 12px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; list-style:none; }
  summary::-webkit-details-marker { display:none; }
  .etitle { color:#f8fafc; font-weight:600; }
  .ekey { color:#7dd3fc; font-size:11px; background:#0b1120; padding:1px 6px; border-radius:5px; }
  .route { color:#a3e635; font-size:11px; }
  .esrc { margin-left:auto; color:#64748b; font-size:11px; }
  table.fields { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.fields th { text-align:left; color:#64748b; font-weight:500; padding:6px 12px; border-top:1px solid #1e293b; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
  table.fields td { padding:7px 12px; border-top:1px solid #1e293b; vertical-align:top; }
  td.fld { color:#93c5fd; font-family:ui-monospace,monospace; white-space:nowrap; }
  td.val { color:#e2e8f0; max-width:560px; }
  td.src { color:#94a3b8; font-family:ui-monospace,monospace; white-space:nowrap; font-size:11px; }
  td.val pre { margin:0; padding:8px; background:#0b1120; border:1px solid #1e293b; border-radius:6px; overflow-x:auto; font-size:11.5px; color:#cbd5e1; max-height:340px; }
  .badge { font-size:10px; padding:1px 7px; border:1px solid; border-radius:999px; white-space:nowrap; }
  .muted { color:#475569; }
  code { font-family:ui-monospace,monospace; }
  a { color:#7dd3fc; }
</style></head>
<body>
<header>
  <h1>JVTO Unified CMS — Static Projection</h1>
  <div class="sub">Release ${esc(projection.releaseVersion)} · generated ${esc(projection.generatedAt.slice(0, 10))} ·
    ${projection.counts.entities} entities from ${projection.counts.records} source records ·
    publication ${projection.publication.validation.passed ? 'PASSED' : 'FAILED'} ·
    ${projection.counts.blockingConflicts} blocking conflicts ·
    DB-free / live-free read-only build artifact (ADR-007)</div>
  <div class="meta">${sourceMeta}</div>
  <div class="legend">${legend}</div>
</header>
<main>${clusterSections}</main>
</body></html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
console.log(
  `Rendered output/cms-projection/index.html — ${projection.counts.entities} entities across ` +
    `${CLUSTER_ORDER.filter((c) => Object.keys(byCluster[c]).length).length} clusters (${html.length} bytes).`,
);
