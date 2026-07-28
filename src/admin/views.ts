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

/** One entity: every field's value + the SOURCE that produced it (provenance). */
export function entityDetail(e: EntityDetailRow): string {
  const data = e.data ?? {};
  const prov = e.provenance ?? {};
  const fieldRows = Object.keys(data)
    .sort()
    .map((f) => {
      const raw = data[f];
      const val = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const shown = val.length > 140 ? val.slice(0, 140) + '…' : val;
      const src = prov[f] ?? '—';
      return `<tr><td class="ro-field">${esc(f)}</td><td>${esc(shown)}</td><td class="ro-field">${esc(src)}</td></tr>`;
    })
    .join('');
  return layout({
    title: e.canonical_key,
    crumbs: `Dashboard › Entities › ${e.canonical_key}`,
    authed: true,
    body: `<h2>${esc(e.canonical_key)} ${e.editable ? badge('editable') : badge('read_only')}</h2>
      <div class="card"><h3>${esc(e.title ?? e.canonical_key)}</h3>
        <div class="ro">type <span class="ro-field">${esc(e.entity_type)}</span> · dominant source <span class="ro-field">${esc(e.source)}</span></div></div>
      <div class="card"><h3>Fields &amp; provenance <span class="count">${Object.keys(data).length}</span></h3>
        <p class="muted">Each field's value and the source that produced it.</p>
        <table><thead><tr><th>field</th><th>value</th><th>produced by</th></tr></thead><tbody>${fieldRows}</tbody></table></div>
      <p><a href="/admin/entities">← All entities</a></p>`,
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
