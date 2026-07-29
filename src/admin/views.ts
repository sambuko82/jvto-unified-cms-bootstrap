// src/admin/views.ts — server-rendered pages for the admin console.

import { layout, esc, badge } from './theme.js';

export interface PageRow {
  route: string;
  file_group: string;
  page_type: string;
  title: string | null;
  status: string;
  editable: boolean;
}
export interface GroupBlock {
  file_group: string;
  label: string;
  pages: PageRow[];
}
export interface EditorPage {
  route: string;
  page_type: string;
  title: string | null;
  h1: string | null;
  status: string;
  editable: boolean;
  seo: Record<string, unknown> | null;
}
export interface EditorSection {
  section_type: string;
  variant: string | null;
  editable: boolean;
  content: Record<string, unknown> | null;
}
export interface Flash {
  ok: boolean;
  messages: string[];
}

export function loginPage(csrf: string, error?: string): string {
  const flash = error ? `<div class="flash err">${esc(error)}</div>` : '';
  const body = `<div class="card" style="max-width:420px;margin:40px auto">
    <h3>Sign in</h3>
    <p class="ro">Enter the admin token to manage content in <code>jvto_cms</code>.</p>
    ${flash}
    <form method="POST" action="/admin/login">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label for="token">Admin token</label>
      <input type="password" id="token" name="token" autocomplete="current-password" autofocus>
      <button type="submit">Sign in</button>
    </form>
  </div>`;
  return layout({ title: 'Sign in', authed: false, body });
}

export function dashboard(groups: GroupBlock[]): string {
  const total = groups.reduce((n, g) => n + g.pages.length, 0);
  const blocks = groups
    .filter((g) => g.pages.length > 0)
    .map((g) => {
      const rows = g.pages
        .map(
          (p) => `<tr>
        <td class="route"><a href="/admin/pages${esc(p.route)}">${esc(p.route)}</a></td>
        <td>${esc(p.title ?? '')}</td>
        <td>${badge(p.status)}</td>
        <td>${p.editable ? badge('editable') : badge('read_only')}</td></tr>`,
        )
        .join('');
      return `<div class="group"><h3>${esc(g.file_group)} · ${esc(g.label)}<span class="count">${g.pages.length}</span></h3>
      <table><thead><tr><th>route</th><th>title</th><th>status</th><th>state</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    })
    .join('');
  return layout({ title: 'Dashboard', crumbs: 'Dashboard', authed: true, body: `<h2>Dashboard <span class="count">${total} pages</span></h2>${blocks}` });
}

function strField(obj: Record<string, unknown> | null, key: string): string {
  const v = obj?.[key];
  return typeof v === 'string' ? v : '';
}

export function pageEditor(page: EditorPage, sections: EditorSection[], csrf: string, flash?: Flash): string {
  const flashHtml = flash
    ? `<div class="flash ${flash.ok ? 'ok' : 'err'}">${flash.ok ? 'Saved.' : 'Rejected by the facts-lock / validation:'}${
        flash.messages.length ? `<ul>${flash.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''
      }</div>`
    : '';

  const pageForm = `<div class="card"><h3>Page fields ${page.editable ? badge('editable') : ''}</h3>
    <div class="ro"><span class="ro-field">${esc(page.route)}</span> · type <span class="ro-field">${esc(page.page_type)}</span> <span class="muted">(read-only)</span></div>
    <form method="POST" action="/admin/pages${esc(page.route)}">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <label>H1 heading</label><input type="text" name="h1" value="${esc(page.h1 ?? '')}">
      <label>SEO title</label><input type="text" name="seo_title" value="${esc(strField(page.seo, 'title'))}">
      <label>SEO description</label><input type="text" name="seo_description" value="${esc(strField(page.seo, 'description'))}">
      <label>Status</label><select name="status">
        <option value="published"${page.status === 'published' ? ' selected' : ''}>published</option>
        <option value="draft"${page.status === 'draft' ? ' selected' : ''}>draft</option>
      </select>
      <button type="submit">Save page fields</button>
    </form></div>`;

  const pc = sections.find((s) => s.section_type === 'page_content');
  const structured = pc && Array.isArray(pc.content?.['sections']);
  const pcForm = pc
    ? `<div class="card"><h3>Body content <code>page_content</code> ${badge('editable')}</h3>
      <div class="ro">Authored content is facts-locked on save (founding 2015 · Ijen mandatory · Package Credit).</div>
      <form method="POST" action="/admin/pages${esc(page.route)}/sections/page_content">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <label>Heading (h1)</label><input type="text" name="h1" value="${esc(strField(pc.content, 'h1'))}">
        <label>Body (markdown)${structured ? ' — this page uses a structured sections[] block; saving here sets body_md' : ''}</label>
        <textarea name="body_md">${esc(strField(pc.content, 'body_md'))}</textarea>
        <button type="submit">Save body</button>
      </form></div>`
    : `<div class="card"><h3>Body content</h3><p class="muted">No <code>page_content</code> section on this page.</p></div>`;

  const others = sections.filter((s) => s.section_type !== 'page_content');
  const othersHtml = `<div class="card"><h3>Designed sections <span class="count">${others.length}</span></h3>
    <table><thead><tr><th>type</th><th>variant</th><th>state</th></tr></thead><tbody>${others
      .map((s) => `<tr><td class="ro-field">${esc(s.section_type)}</td><td>${esc(s.variant ?? '—')}</td><td>${s.editable ? badge('editable') : badge('read_only')}</td></tr>`)
      .join('')}</tbody></table>
    <p class="muted" style="margin-top:8px">Designed sections render from code + hydrated entities.</p></div>`;

  return layout({
    title: `Edit ${page.route}`,
    crumbs: `Dashboard › ${page.route}`,
    authed: true,
    body: `<h2>${esc(page.title ?? page.route)}</h2>${flashHtml}${pageForm}${pcForm}${othersHtml}`,
  });
}

export function publishingView(
  pendingPages: PageRow[],
  pendingSections: Array<{ route: string; section_type: string }>,
  csrf: string,
): string {
  const pagesHtml = pendingPages.length
    ? `<table><thead><tr><th>route</th><th>status</th></tr></thead><tbody>${pendingPages
        .map((p) => `<tr><td class="route"><a href="/admin/pages${esc(p.route)}">${esc(p.route)}</a></td><td>${badge(p.status)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No pending page edits.</p>';
  const secHtml = pendingSections.length
    ? `<table><thead><tr><th>route</th><th>section</th></tr></thead><tbody>${pendingSections
        .map((s) => `<tr><td class="route">${esc(s.route)}</td><td class="ro-field">${esc(s.section_type)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="muted">No pending section edits.</p>';
  const body = `<h2>Publishing</h2>
    <div class="card"><h3>Pending console edits <span class="count">${pendingPages.length + pendingSections.length}</span></h3>
      <label>Pages</label>${pagesHtml}
      <label>Sections</label>${secHtml}</div>
    <div class="card"><h3>Publish</h3>
      <p class="muted">Publishing exports <code>jvto_cms</code> → <code>output/seed/*</code> (the seed jvto-web renders). Wired in the next slice.</p>
      <form method="POST" action="/admin/publish"><input type="hidden" name="csrf" value="${esc(csrf)}">
        <button type="submit">Publish edits</button></form></div>`;
  return layout({ title: 'Publishing', crumbs: 'Dashboard › Publishing', authed: true, body });
}

// ── Entity Registry + provenance (PRD §8/§9 module surface) ──────────────────
export interface EntityRow {
  canonical_key: string;
  entity_type: string;
  title: string | null;
  source: string;
  editable: boolean;
}
export interface EntityDetailRow extends EntityRow {
  data: Record<string, unknown> | null;
  provenance: Record<string, string> | null;
}

// ── Established sources + field ownership (config/*.yaml, surfaced read-only) ──
export interface OwnershipRule {
  entity_type: string;
  field_path: string;
  owner_source: string;
  write_policy: string;
  conflict_policy: string;
}
export interface SourceDef {
  code: string;
  name?: string;
  role?: string;
  source_type?: string;
  authority_rank?: number;
  repository?: string;
}

/** Resolve a field's ownership rule: exact entity::field, else entity::* wildcard.
 *  Mirrors scripts/render-cms.mjs `fieldPolicy` so the console matches the projection. */
export function fieldPolicy(
  rules: OwnershipRule[],
  entityType: string,
  field: string,
): { owner: string | null; policy: string } {
  const exact = rules.find((r) => r.entity_type === entityType && r.field_path === field);
  const wild = rules.find((r) => r.entity_type === entityType && r.field_path === '*');
  const rule = exact ?? wild;
  return rule ? { owner: rule.owner_source, policy: rule.write_policy } : { owner: null, policy: 'context' };
}

/** Browse every content atom grouped by entity_type; each links to its provenance detail. */
export function entitiesIndex(rows: EntityRow[]): string {
  const byType = new Map<string, EntityRow[]>();
  for (const r of rows) {
    const list = byType.get(r.entity_type) ?? [];
    list.push(r);
    byType.set(r.entity_type, list);
  }
  const blocks = [...byType.keys()]
    .sort()
    .map((t) => {
      const list = byType.get(t) ?? [];
      const trs = list
        .map(
          (e) => `<tr>
        <td class="route"><a href="/admin/entities/${esc(e.canonical_key)}">${esc(e.canonical_key)}</a></td>
        <td>${esc(e.title ?? '')}</td>
        <td class="ro-field">${esc(e.source)}</td>
        <td>${e.editable ? badge('editable') : badge('read_only')}</td></tr>`,
        )
        .join('');
      return `<div class="group"><h3>${esc(t)}<span class="count">${list.length}</span></h3>
      <table><thead><tr><th>canonical key</th><th>title</th><th>dominant source</th><th>state</th></tr></thead><tbody>${trs}</tbody></table></div>`;
    })
    .join('');
  return layout({
    title: 'Entity Registry',
    crumbs: 'Dashboard › Entities',
    authed: true,
    body: `<h2>Entity Registry <span class="count">${rows.length} atoms</span></h2>
      <p class="muted">Every content atom, grouped by type. Open one to see which source produced each field — the CMS never erases where a fact came from.</p>${blocks}`,
  });
}

/** One entity: every field's value, the SOURCE that PRODUCED it (provenance), the
 *  configured OWNER + write policy (field-ownership). When producer ≠ owner the
 *  field was filled by a non-owner staged value (e.g. crew name/bio). */
export function entityDetail(e: EntityDetailRow, rules: OwnershipRule[] = []): string {
  const data = e.data ?? {};
  const prov = e.provenance ?? {};
  let gapFills = 0;
  const fieldRows = Object.keys(data)
    .sort()
    .map((f) => {
      const raw = data[f];
      const val = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const shown = val.length > 140 ? val.slice(0, 140) + '…' : val;
      const src = prov[f] ?? '—';
      const { owner, policy } = fieldPolicy(rules, e.entity_type, f);
      const ownerShown = owner ?? '—';
      const mismatch = owner && src !== '—' && owner !== src;
      if (mismatch) gapFills++;
      const ownerCell = `<span class="ro-field">${esc(ownerShown)}</span>${
        mismatch ? ' <span class="badge" style="color:#fbbf24;background:rgba(245,158,11,.12);border-color:#fbbf2455">gap-fill</span>' : ''
      }`;
      return `<tr><td class="ro-field">${esc(f)}</td><td>${esc(shown)}</td>
        <td class="ro-field">${esc(src)}</td><td>${ownerCell}</td><td>${badge(policy)}</td></tr>`;
    })
    .join('');
  const gapNote = gapFills
    ? `<p class="muted" style="margin:0 0 10px">${gapFills} field(s) marked <span class="badge" style="color:#fbbf24;background:rgba(245,158,11,.12);border-color:#fbbf2455">gap-fill</span>: produced by a non-owner source that filled an empty owned field (staged under <code>prefer_owner</code>) — the owner never gets overwritten.</p>`
    : '';
  return layout({
    title: e.canonical_key,
    crumbs: `Dashboard › Entities › ${e.canonical_key}`,
    authed: true,
    body: `<h2>${esc(e.canonical_key)} ${e.editable ? badge('editable') : badge('read_only')}</h2>
      <div class="card"><h3>${esc(e.title ?? e.canonical_key)}</h3>
        <div class="ro">type <span class="ro-field">${esc(e.entity_type)}</span> · dominant source <span class="ro-field">${esc(e.source)}</span></div></div>
      <div class="card"><h3>Fields · provenance · ownership <span class="count">${Object.keys(data).length}</span></h3>
        <p class="muted">Each field's value, the source that <strong>produced</strong> it, and the configured <strong>owner</strong> + write policy (<code>config/field-ownership.yaml</code>).</p>
        ${gapNote}
        <table><thead><tr><th>field</th><th>value</th><th>produced by</th><th>owned by</th><th>policy</th></tr></thead><tbody>${fieldRows}</tbody></table></div>
      <p><a href="/admin/entities">← All entities</a> · <a href="/admin/sources">Sources &amp; ownership →</a></p>`,
  });
}

/** Sources & ownership: the established registry + field-ownership rules, surfaced
 *  read-only and cross-referenced with which sources actually produced data. */
export function sourcesAndOwnership(
  sources: SourceDef[],
  rules: OwnershipRule[],
  usage: Array<{ source: string; owned: number; produced: number }>,
): string {
  const use = new Map(usage.map((u) => [u.source, u]));
  const srcRows = [...sources]
    .sort((a, b) => (b.authority_rank ?? 0) - (a.authority_rank ?? 0) || a.code.localeCompare(b.code))
    .map((s) => {
      const u = use.get(s.code);
      const inUse = u && (u.owned > 0 || u.produced > 0);
      const usageCell = inUse
        ? `${u!.owned} owned · ${u!.produced} fields`
        : '<span class="muted">not producing</span>';
      return `<tr><td class="ro-field">${esc(s.code)}</td><td>${esc(s.name ?? '')}</td>
        <td class="ro-field">${esc(s.role ?? '—')}</td><td>${s.authority_rank ?? '—'}</td>
        <td>${usageCell}</td></tr>`;
    })
    .join('');

  const ruleRows = [...rules]
    .sort((a, b) => a.entity_type.localeCompare(b.entity_type) || a.field_path.localeCompare(b.field_path))
    .map(
      (r) => `<tr><td class="ro-field">${esc(r.entity_type)}</td><td class="ro-field">${esc(r.field_path)}</td>
      <td class="ro-field">${esc(r.owner_source)}</td><td>${badge(r.write_policy)}</td>
      <td class="ro-field">${esc(r.conflict_policy)}</td></tr>`,
    )
    .join('');

  return layout({
    title: 'Sources & ownership',
    crumbs: 'Dashboard › Sources',
    authed: true,
    body: `<h2>Sources &amp; ownership <span class="count">${sources.length} sources · ${rules.length} rules</span></h2>
      <p class="muted">The established source registry and field-ownership rules that govern consolidation — read straight from <code>config/source-registry.yaml</code> and <code>config/field-ownership.yaml</code>, cross-referenced with the data each source actually produced.</p>
      <div class="card"><h3>Registered sources <span class="count">${sources.length}</span></h3>
        <p class="muted">Ordered by <strong>authority rank</strong> (higher wins conflicts). "Owned" = entities this source dominates; "fields" = individual values it produced (provenance).</p>
        <table><thead><tr><th>code</th><th>name</th><th>role</th><th>rank</th><th>in use</th></tr></thead><tbody>${srcRows}</tbody></table></div>
      <div class="card"><h3>Field-ownership rules <span class="count">${rules.length}</span></h3>
        <p class="muted">Which source owns each field, its write policy, and what happens when a non-owner proposes a change.</p>
        <table><thead><tr><th>entity type</th><th>field</th><th>owner</th><th>policy</th><th>on conflict</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
      <p><a href="/admin/entities">← Entities</a></p>`,
  });
}

// ── Governance overview (PRD §20 health/metrics surface, live-DB only) ────────
export interface GovernanceMetrics {
  totals: { entities: number; pages: number; sections: number; redirects: number; facts: number; claims: number; sources: number };
  entitiesByType: Array<{ entity_type: string; n: number }>;
  sources: Array<{ source: string; owned: number; produced: number }>;
  pagesByStatus: Array<{ status: string; n: number }>;
  pagesEditable: number;
  pagesReadOnly: number;
  audit: Array<{ at: string; actor: string; action: string; target: string; summary: string | null }>;
}

/** A read-only health/metrics dashboard, computed from live aggregate queries only. */
export function governanceOverview(m: GovernanceMetrics): string {
  const tile = (n: number, k: string) => `<div class="metric"><div class="n">${n}</div><div class="k">${esc(k)}</div></div>`;
  const tiles = `<div class="metrics">
    ${tile(m.totals.entities, 'Entities')}
    ${tile(m.totals.pages, 'Pages')}
    ${tile(m.totals.sections, 'Sections')}
    ${tile(m.totals.claims, 'Trust claims')}
    ${tile(m.totals.facts, 'Governance facts')}
    ${tile(m.totals.redirects, 'Redirects')}
    ${tile(m.totals.sources, 'Sources')}
  </div>`;

  const typeRows = m.entitiesByType
    .map((r) => `<tr><td class="ro-field">${esc(r.entity_type)}</td><td>${r.n}</td></tr>`)
    .join('');
  const entitiesBlock = `<div class="card"><h3>Entities by type <span class="count">${m.totals.entities}</span></h3>
    <table><thead><tr><th>type</th><th>count</th></tr></thead><tbody>${typeRows}</tbody></table></div>`;

  const sourceRows = m.sources
    .map(
      (r) => `<tr><td class="ro-field">${esc(r.source)}</td><td>${r.owned}</td>
      <td>${r.produced}${r.owned === 0 ? ' <span class="muted">(field-level)</span>' : ''}</td></tr>`,
    )
    .join('');
  const sourcesBlock = `<div class="card"><h3>Sources in use <span class="count">${m.sources.length}</span></h3>
    <p class="muted">Every source that produced data — entities it dominantly <strong>owns</strong>, and individual <strong>fields</strong> it produced (from provenance). A source can contribute fields without owning any entity.</p>
    <table><thead><tr><th>source</th><th>owns</th><th>fields</th></tr></thead><tbody>${sourceRows}</tbody></table></div>`;

  const statusRows = m.pagesByStatus
    .map((r) => `<tr><td>${badge(r.status)}</td><td>${r.n}</td></tr>`)
    .join('');
  const pagesBlock = `<div class="card"><h3>Pages</h3>
    <table><thead><tr><th>status</th><th>count</th></tr></thead><tbody>${statusRows}</tbody></table>
    <p style="margin:12px 0 0">${badge('editable')} ${m.pagesEditable} console-editable · ${badge('read_only')} ${m.pagesReadOnly} synced</p></div>`;

  const auditRows = m.audit.length
    ? `<table><thead><tr><th>when</th><th>actor</th><th>action</th><th>target</th><th>note</th></tr></thead><tbody>${m.audit
        .map(
          (a) => `<tr><td class="ro-field">${esc(a.at)}</td><td>${esc(a.actor)}</td><td class="ro-field">${esc(a.action)}</td>
        <td class="route">${esc(a.target)}</td><td>${esc(a.summary ?? '')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="muted">No console writes recorded yet — edits and publishes appear here.</p>';
  const auditBlock = `<div class="card"><h3>Recent activity <span class="count">${m.audit.length}</span></h3>${auditRows}</div>`;

  return layout({
    title: 'Governance overview',
    crumbs: 'Dashboard › Overview',
    authed: true,
    body: `<h2>Governance overview</h2>
      <p class="muted">Live health of the control plane — every number is an aggregate query against <code>jvto_cms</code>, computed on request.</p>
      ${tiles}
      <div class="split">${entitiesBlock}${sourcesBlock}</div>
      ${pagesBlock}
      ${auditBlock}`,
  });
}

export function publishResult(opts: { ok: boolean; output: string; diff: string; outDir: string }): string {
  const pre = (text: string, color: string) =>
    `<pre style="margin:0;white-space:pre-wrap;font-size:12px;color:${color}">${esc(text)}</pre>`;
  const body = `<h2>Publish result</h2>
    <div class="flash ${opts.ok ? 'ok' : 'err'}">${
      opts.ok ? `Exported <code>jvto_cms</code> → <code>${esc(opts.outDir)}</code> (the seed jvto-web renders).` : 'Publish failed.'
    }</div>
    ${opts.diff ? `<div class="card"><h3>Changed seed files</h3>${pre(opts.diff, '#cbd5e1')}</div>` : ''}
    <div class="card"><h3>Export log</h3>${pre(opts.output, '#94a3b8')}</div>
    <p><a href="/admin/publishing">← Back to Publishing</a></p>`;
  return layout({ title: 'Publish result', crumbs: 'Dashboard › Publishing › Publish', authed: true, body });
}

// ── Media library: swap the images shown on the site ──────────────────────────
export interface AssetRow {
  key: string;
  kind: string | null;
  url: string;
  alt: string | null;
  editable: boolean;
  meta: Record<string, unknown> | null;
}

export function mediaLibrary(assets: AssetRow[], csrf: string, flash?: Flash): string {
  const flashHtml = flash
    ? flash.ok
      ? '<div class="flash ok">Saved — the swap is marked editable and reaches the live site on the next jvto_dev sync.</div>'
      : `<div class="flash err">Could not save:<ul>${flash.messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
    : '';
  const byGroup = new Map<string, AssetRow[]>();
  for (const a of assets) {
    const g = a.meta && typeof a.meta['group'] === 'string' ? (a.meta['group'] as string) : 'other';
    const list = byGroup.get(g) ?? [];
    list.push(a);
    byGroup.set(g, list);
  }
  const groups = [...byGroup.keys()]
    .sort()
    .map((g) => {
      const list = byGroup.get(g) ?? [];
      const cards = list
        .map((a) => {
          const link = a.meta && typeof a.meta['link'] === 'object' ? (a.meta['link'] as Record<string, unknown>) : null;
          const attaches = link
            ? [link['type'], link['ref'], link['field']].filter(Boolean).map((x) => esc(x)).join(' · ')
            : '—';
          return `<div class="card"><div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
            <img src="${esc(a.url)}" alt="${esc(a.alt ?? '')}" loading="lazy" referrerpolicy="no-referrer"
                 style="width:120px;height:80px;object-fit:cover;border-radius:8px;background:#0b1120;border:1px solid #1e293b">
            <div style="flex:1;min-width:220px">
              <h3 style="word-break:break-all">${esc(a.key)} ${badge(a.editable ? 'editable' : 'read_only')}</h3>
              <div class="ro">attaches to: ${attaches}</div>
              <form method="POST" action="/admin/media/${esc(a.key)}">
                <input type="hidden" name="csrf" value="${esc(csrf)}">
                <label>Image URL</label>
                <input type="text" name="url" value="${esc(a.url)}">
                <label>Alt text</label>
                <input type="text" name="alt" value="${esc(a.alt ?? '')}">
                <button type="submit">Save swap</button>
              </form>
            </div></div></div>`;
        })
        .join('');
      return `<div class="group"><h3>${esc(g)}<span class="count">${list.length}</span></h3>${cards}</div>`;
    })
    .join('');
  const body = `<h2>Media library <span class="count">${assets.length}</span></h2>
    <p class="muted">Swap the image URL or alt text for anything shown on the site — not just text. Saved swaps are marked ${badge('editable')} and survive upstream reloads; they publish to the live site on the next <code>jvto_dev</code> sync.</p>
    ${flashHtml}${groups}`;
  return layout({ title: 'Media library', crumbs: 'Dashboard › Media', authed: true, body });
}
