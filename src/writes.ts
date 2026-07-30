// src/writes.ts — the shared write core (facts-locked, transactional, audited).
//
// Both the JSON write API (src/server.ts) and the admin console forms
// (src/admin/routes.ts) call these, so a console edit and an API edit go through
// exactly the same governance: facts-lock gate → editable=true → audit_log.

import { withTransaction } from './db.js';
import { checkWritePayload } from './factsGate.js';
import { normalizeRoute } from './resolvePage.js';

export interface WriteResult {
  status: number;
  body: Record<string, unknown>;
}

const ALLOWED_STATUS = new Set(['draft', 'published']);

/** Edit page-level fields { seo?, h1?, status? }. `actor` is recorded in audit_log. */
export async function patchPage(
  rawRoute: string,
  fields: { seo?: unknown; h1?: unknown; status?: unknown },
  actor: string,
): Promise<WriteResult> {
  const route = normalizeRoute(rawRoute);
  const setClauses: string[] = [];
  const fieldNames: string[] = [];
  const values: unknown[] = [];

  if (fields.seo !== undefined) {
    if (typeof fields.seo !== 'object' || fields.seo === null || Array.isArray(fields.seo)) {
      return { status: 400, body: { error: 'Bad Request', message: 'seo must be a JSON object.' } };
    }
    values.push(JSON.stringify(fields.seo));
    setClauses.push(`seo = $${values.length}::jsonb`);
    fieldNames.push('seo');
  }
  if (fields.h1 !== undefined) {
    if (typeof fields.h1 !== 'string') {
      return { status: 400, body: { error: 'Bad Request', message: 'h1 must be a string.' } };
    }
    values.push(fields.h1);
    setClauses.push(`h1 = $${values.length}`);
    fieldNames.push('h1');
  }
  if (fields.status !== undefined) {
    if (typeof fields.status !== 'string' || !ALLOWED_STATUS.has(fields.status)) {
      return { status: 400, body: { error: 'Bad Request', message: 'status must be "draft" or "published".' } };
    }
    values.push(fields.status);
    setClauses.push(`status = $${values.length}`);
    fieldNames.push('status');
  }
  if (setClauses.length === 0) {
    return { status: 400, body: { error: 'Bad Request', message: 'Provide at least one of seo, h1, status.' } };
  }

  const gate = await checkWritePayload({ seo: fields.seo, h1: fields.h1 });
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  values.push(route);
  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE pages SET ${setClauses.join(', ')}, editable = true WHERE route = $${values.length} RETURNING route`,
      values,
    );
    const rowCount = res.rowCount ?? 0;
    if (rowCount > 0) {
      await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
        actor,
        'patch_page',
        route,
        `fields: ${fieldNames.join(', ')}`,
      ]);
    }
    return rowCount;
  });
  if (updated === 0) return { status: 404, body: { error: 'Not Found', route } };
  return { status: 200, body: { ok: true, route, editable: true, fields: fieldNames } };
}

/** Swap an asset's { url?, alt? } (operator image replacement). Sets editable=true;
 * the jvto_dev sync then carries the swap to the live site. `actor` recorded in audit_log. */
export async function putAsset(
  key: string,
  fields: { url?: unknown; alt?: unknown },
  actor: string,
): Promise<WriteResult> {
  if (!key) return { status: 400, body: { error: 'Bad Request', message: 'Missing asset key.' } };
  const setClauses: string[] = [];
  const fieldNames: string[] = [];
  const values: unknown[] = [];

  if (fields.url !== undefined) {
    if (typeof fields.url !== 'string' || !/^https?:\/\/\S+$/i.test(fields.url)) {
      return { status: 400, body: { error: 'Bad Request', message: 'url must be an http(s) URL.' } };
    }
    values.push(fields.url);
    setClauses.push(`url = $${values.length}`);
    fieldNames.push('url');
  }
  if (fields.alt !== undefined) {
    if (typeof fields.alt !== 'string') {
      return { status: 400, body: { error: 'Bad Request', message: 'alt must be a string.' } };
    }
    values.push(fields.alt);
    setClauses.push(`alt = $${values.length}`);
    fieldNames.push('alt');
  }
  if (setClauses.length === 0) {
    return { status: 400, body: { error: 'Bad Request', message: 'Provide url and/or alt.' } };
  }

  // alt is customer-visible prose → facts-locked (url is not scanned as prose)
  const gate = await checkWritePayload({ alt: fields.alt });
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  values.push(key);
  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE assets SET ${setClauses.join(', ')}, editable = true WHERE key = $${values.length} RETURNING key`,
      values,
    );
    const rowCount = res.rowCount ?? 0;
    if (rowCount > 0) {
      await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
        actor,
        'put_asset',
        key,
        `fields: ${fieldNames.join(', ')}`,
      ]);
    }
    return rowCount;
  });
  if (updated === 0) return { status: 404, body: { error: 'Not Found', key } };
  return { status: 200, body: { ok: true, key, editable: true, fields: fieldNames } };
}

/** Replace a section's content jsonb. `actor` is recorded in audit_log. */
export async function putSection(
  rawRoute: string,
  sectionType: string,
  content: unknown,
  actor: string,
): Promise<WriteResult> {
  const route = normalizeRoute(rawRoute);
  if (!sectionType) return { status: 400, body: { error: 'Bad Request', message: 'Missing section type.' } };
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return { status: 400, body: { error: 'Bad Request', message: 'content must be a JSON object.' } };
  }

  const gate = await checkWritePayload(content);
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  const contentKeys = Object.keys(content as Record<string, unknown>);
  const updated = await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE page_sections SET content = $1::jsonb, editable = true
         WHERE section_type = $2 AND page_id = (SELECT id FROM pages WHERE route = $3)
         RETURNING id`,
      [JSON.stringify(content), sectionType, route],
    );
    const rowCount = res.rowCount ?? 0;
    if (rowCount > 0) {
      await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
        actor,
        'put_section',
        `${route}#${sectionType}`,
        `keys: ${contentKeys.join(', ')}`,
      ]);
    }
    return rowCount;
  });
  if (updated === 0) return { status: 404, body: { error: 'Not Found', route, section_type: sectionType } };
  return { status: 200, body: { ok: true, route, section_type: sectionType, editable: true } };
}

// ── ADD (operator-authored NEW content) ──────────────────────────────────────
// Everything created here is editable=true, so deploy-prod's seed re-apply never prunes it
// (load.sql deletes only `editable IS NOT TRUE` rows). Same facts-lock + audit as edits.

const ALLOWED_PAGE_TYPES = new Set([
  'homepage', 'hub', 'tour', 'destination', 'travel_guide', 'verify', 'policy', 'narrative', 'faq', 'contact', 'blog', 'crew_profile',
]);
const ALLOWED_SECTION_TYPES = new Set([
  'hero', 'section_head', 'rich_text', 'callout', 'steps', 'vantage', 'dest_facts', 'data_box', 'timeline', 'faq_list', 'card_grid', 'cta', 'gallery',
]);

/** Create a NEW page at `route`. Operator pages live in the `operator` file_group and default
 * to status=draft so they don't go live until published. `actor` recorded in audit_log. */
export async function createPage(
  fields: { route?: unknown; title?: unknown; page_type?: unknown; status?: unknown; seo?: unknown; h1?: unknown },
  actor: string,
): Promise<WriteResult> {
  if (typeof fields.route !== 'string' || !/^\/[a-z0-9][a-z0-9\-/]*$/i.test(fields.route)) {
    return { status: 400, body: { error: 'Bad Request', message: 'route must be a path like /travel-guide/new-topic (letters, digits, - and /).' } };
  }
  const route = normalizeRoute(fields.route);
  if (route === '/') return { status: 400, body: { error: 'Bad Request', message: 'The home route "/" already exists.' } };
  if (fields.title !== undefined && fields.title !== null && typeof fields.title !== 'string') {
    return { status: 400, body: { error: 'Bad Request', message: 'title must be a string.' } };
  }
  const pageType = typeof fields.page_type === 'string' && fields.page_type ? fields.page_type : 'narrative';
  if (!ALLOWED_PAGE_TYPES.has(pageType)) {
    return { status: 400, body: { error: 'Bad Request', message: `page_type must be one of: ${[...ALLOWED_PAGE_TYPES].join(', ')}.` } };
  }
  const status = typeof fields.status === 'string' && ALLOWED_STATUS.has(fields.status) ? fields.status : 'draft';
  if (fields.seo !== undefined && (typeof fields.seo !== 'object' || fields.seo === null || Array.isArray(fields.seo))) {
    return { status: 400, body: { error: 'Bad Request', message: 'seo must be a JSON object.' } };
  }
  const title = typeof fields.title === 'string' ? fields.title : null;
  const h1 = typeof fields.h1 === 'string' ? fields.h1 : title;
  const seo = (fields.seo as Record<string, unknown>) ?? {};

  const gate = await checkWritePayload({ title, h1, seo });
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  const inserted = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO pages (route, file_group, page_type, title, h1, seo, status, editable, sort_order)
       VALUES ($1, 'operator', $2, $3, $4, $5::jsonb, $6, true,
               COALESCE((SELECT MAX(sort_order) + 1 FROM pages WHERE file_group = 'operator'), 0))
       ON CONFLICT (route) DO NOTHING
       RETURNING route`,
      [route, pageType, title, h1, JSON.stringify(seo), status],
    );
    const rowCount = res.rowCount ?? 0;
    if (rowCount > 0) {
      await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
        actor, 'create_page', route, `page_type: ${pageType}, status: ${status}`,
      ]);
    }
    return rowCount;
  });
  if (inserted === 0) return { status: 409, body: { error: 'Conflict', message: `A page already exists at ${route}.`, route } };
  return { status: 201, body: { ok: true, route, editable: true, page_type: pageType, status } };
}

/** Append a NEW section to an existing page. Operator sections use a high sort_order band
 * (>=1000) so they never collide with synced sections and always render after them. */
export async function addSection(
  rawRoute: string,
  fields: { section_type?: unknown; variant?: unknown; content?: unknown },
  actor: string,
): Promise<WriteResult> {
  const route = normalizeRoute(rawRoute);
  if (typeof fields.section_type !== 'string' || !ALLOWED_SECTION_TYPES.has(fields.section_type)) {
    return { status: 400, body: { error: 'Bad Request', message: `section_type must be one of: ${[...ALLOWED_SECTION_TYPES].join(', ')}.` } };
  }
  const content = fields.content ?? {};
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return { status: 400, body: { error: 'Bad Request', message: 'content must be a JSON object.' } };
  }
  const variant = typeof fields.variant === 'string' && fields.variant ? fields.variant : null;
  const gate = await checkWritePayload(content as Record<string, unknown>);
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  const result = await withTransaction<{ notFound: boolean }>(async (client) => {
    const page = await client.query('SELECT id FROM pages WHERE route = $1', [route]);
    if ((page.rowCount ?? 0) === 0) return { notFound: true };
    const pageId = page.rows[0].id as string;
    await client.query(
      `INSERT INTO page_sections (page_id, sort_order, section_type, variant, content, editable)
       VALUES ($1,
               COALESCE((SELECT MAX(sort_order) + 1 FROM page_sections WHERE page_id = $1 AND sort_order >= 1000), 1000),
               $2, $3, $4::jsonb, true)`,
      [pageId, fields.section_type, variant, JSON.stringify(content)],
    );
    await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
      actor, 'add_section', `${route}#${fields.section_type}`, `keys: ${Object.keys(content as Record<string, unknown>).join(', ') || '(empty)'}`,
    ]);
    return { notFound: false };
  });
  if (result.notFound) return { status: 404, body: { error: 'Not Found', route } };
  return { status: 201, body: { ok: true, route, section_type: fields.section_type, editable: true } };
}

/** Register a NEW asset (operator-added image). `key` is the stable identity; `alt` is
 * facts-locked prose. editable=true so it survives upstream refresh + prune. */
export async function createAsset(
  fields: { key?: unknown; url?: unknown; alt?: unknown; kind?: unknown; group?: unknown },
  actor: string,
): Promise<WriteResult> {
  if (typeof fields.key !== 'string' || !/^[a-z0-9][a-z0-9._\-/]*$/i.test(fields.key)) {
    return { status: 400, body: { error: 'Bad Request', message: 'key must be a slug like gallery/my-photo-01 (letters, digits, . _ - /).' } };
  }
  if (typeof fields.url !== 'string' || !/^https?:\/\/\S+$/i.test(fields.url)) {
    return { status: 400, body: { error: 'Bad Request', message: 'url must be an http(s) URL.' } };
  }
  if (fields.alt !== undefined && fields.alt !== null && typeof fields.alt !== 'string') {
    return { status: 400, body: { error: 'Bad Request', message: 'alt must be a string.' } };
  }
  const kind = typeof fields.kind === 'string' && ['image', 'video', 'document'].includes(fields.kind) ? fields.kind : 'image';
  const group = typeof fields.group === 'string' && fields.group ? fields.group : 'operator';
  const alt = typeof fields.alt === 'string' ? fields.alt : null;
  const meta = { group, source_category: 'operator' };

  const gate = await checkWritePayload({ alt });
  if (!gate.ok) return { status: 400, body: { error: 'Facts-lock violation', violations: gate.violations } };

  const inserted = await withTransaction(async (client) => {
    const res = await client.query(
      `INSERT INTO assets (key, kind, url, alt, meta, editable) VALUES ($1, $2, $3, $4, $5::jsonb, true)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
      [fields.key, kind, fields.url, alt, JSON.stringify(meta)],
    );
    const rowCount = res.rowCount ?? 0;
    if (rowCount > 0) {
      await client.query('INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)', [
        actor, 'create_asset', fields.key, `kind: ${kind}, group: ${group}`,
      ]);
    }
    return rowCount;
  });
  if (inserted === 0) return { status: 409, body: { error: 'Conflict', message: `An asset already exists with key ${fields.key}.`, key: fields.key } };
  return { status: 201, body: { ok: true, key: fields.key, editable: true, kind } };
}
