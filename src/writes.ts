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
