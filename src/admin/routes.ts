// src/admin/routes.ts — the server-rendered admin console (ADR-008).
//
// Session-cookie auth (signed, HttpOnly, SameSite=Strict) + per-form CSRF; edits
// go through the SAME write core as the JSON API (facts-locked, audited).

import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { query } from '../db.js';
import { normalizeRoute } from '../resolvePage.js';
import { patchPage, putSection } from '../writes.js';
import type { WriteResult } from '../writes.js';
import {
  adminToken,
  constantTimeEqual,
  isAuthenticated,
  SESSION_COOKIE,
  SESSION_VALUE,
} from '../auth.js';
import { layout, esc } from './theme.js';
import { loginPage, dashboard, pageEditor, publishingView, publishResult, entitiesIndex, entityDetail, governanceOverview } from './views.js';
import type { PageRow, GroupBlock, EditorPage, EditorSection, Flash, EntityRow, EntityDetailRow, GovernanceMetrics } from './views.js';

const CSRF_COOKIE = 'cms_csrf';
const ADMIN_ACTOR = 'admin-console';
const execFileAsync = promisify(execFile);
// Real deployments always sit behind TLS (Nginx); only withhold Secure in dev/test
// so cookies still work over plain http://localhost.
const SECURE_COOKIES = process.env.NODE_ENV === 'production';

function loadGroupLabels(): Record<string, { label: string }> {
  const p = fileURLToPath(new URL('../../config/pages.yaml', import.meta.url));
  const parsed = parseYaml(readFileSync(p, 'utf8')) as { groups?: Record<string, { label: string }> };
  return parsed.groups ?? {};
}

function issueCsrf(reply: FastifyReply): string {
  const token = randomBytes(16).toString('hex');
  reply.setCookie(CSRF_COOKIE, token, {
    path: '/admin',
    httpOnly: true,
    sameSite: 'strict',
    secure: SECURE_COOKIES,
    signed: true,
  });
  return token;
}

function csrfOk(req: FastifyRequest): boolean {
  const cookie = req.cookies?.[CSRF_COOKIE];
  const submitted = (req.body as Record<string, unknown> | undefined)?.['csrf'];
  if (!cookie || typeof submitted !== 'string') return false;
  const unsigned = req.unsignCookie(cookie);
  return unsigned.valid && typeof unsigned.value === 'string' && constantTimeEqual(unsigned.value, submitted);
}

async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
  if (!isAuthenticated(req)) return reply.redirect('/admin/login');
  return undefined;
}

const notFound = (route: string): string =>
  layout({
    title: 'Not found',
    authed: true,
    body: `<div class="flash err">Route not found: ${esc(route)}</div><p><a href="/admin">Back to dashboard</a></p>`,
  });

function violations(result: WriteResult): string[] {
  const v = result.body['violations'];
  if (Array.isArray(v)) return v.map(String);
  const msg = result.body['message'] ?? result.body['error'];
  return msg ? [String(msg)] : [];
}

async function editorHtml(reply: FastifyReply, route: string, flash?: Flash): Promise<string | null> {
  const pageRes = await query<EditorPage>(
    'SELECT route, page_type, title, h1, status, editable, seo FROM pages WHERE route = $1',
    [route],
  );
  const page = pageRes.rows[0];
  if (!page) return null;
  const secRes = await query<EditorSection>(
    `SELECT section_type, variant, editable, content FROM page_sections
       WHERE page_id = (SELECT id FROM pages WHERE route = $1) ORDER BY sort_order`,
    [route],
  );
  const csrf = issueCsrf(reply);
  return pageEditor(page, secRes.rows, csrf, flash);
}

export function registerAdmin(app: FastifyInstance): void {
  const groupLabels = loadGroupLabels();

  // ── Session ─────────────────────────────────────────────────────────────────
  app.get('/admin/login', async (_req, reply) => {
    const csrf = issueCsrf(reply);
    return reply.type('text/html').send(loginPage(csrf));
  });

  app.post('/admin/login', async (req, reply) => {
    if (!csrfOk(req)) {
      const csrf = issueCsrf(reply);
      return reply.code(403).type('text/html').send(loginPage(csrf, 'Session expired — please retry.'));
    }
    const submitted = (req.body as Record<string, unknown> | undefined)?.['token'];
    const expected = adminToken();
    if (!expected || typeof submitted !== 'string' || !constantTimeEqual(submitted, expected)) {
      const csrf = issueCsrf(reply);
      return reply.code(401).type('text/html').send(loginPage(csrf, 'Incorrect admin token.'));
    }
    reply.setCookie(SESSION_COOKIE, SESSION_VALUE, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: SECURE_COOKIES,
      signed: true,
      maxAge: 8 * 3600,
    });
    return reply.redirect('/admin');
  });

  app.post('/admin/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/admin/login');
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────
  app.get('/admin', { preHandler: requireSession }, async (_req, reply) => {
    const { rows } = await query<PageRow>(
      'SELECT route, file_group, page_type, title, status, editable FROM pages ORDER BY file_group, sort_order',
    );
    const byGroup = new Map<string, PageRow[]>();
    for (const r of rows) {
      const list = byGroup.get(r.file_group) ?? [];
      list.push(r);
      byGroup.set(r.file_group, list);
    }
    const groups: GroupBlock[] = [...byGroup.keys()].sort().map((fg) => ({
      file_group: fg,
      label: groupLabels[fg]?.label ?? fg,
      pages: byGroup.get(fg) ?? [],
    }));
    return reply.type('text/html').send(dashboard(groups));
  });

  // ── Entity Registry + provenance ────────────────────────────────────────────
  app.get('/admin/entities', { preHandler: requireSession }, async (_req, reply) => {
    const { rows } = await query<EntityRow>(
      'SELECT canonical_key, entity_type, title, source, editable FROM entities ORDER BY entity_type, canonical_key',
    );
    return reply.type('text/html').send(entitiesIndex(rows));
  });

  app.get('/admin/entities/*', { preHandler: requireSession }, async (req, reply) => {
    const key = (req.params as Record<string, string>)['*'] ?? '';
    const { rows } = await query<EntityDetailRow>(
      'SELECT canonical_key, entity_type, title, source, editable, data, provenance FROM entities WHERE canonical_key = $1',
      [key],
    );
    const entity = rows[0];
    if (!entity) return reply.code(404).type('text/html').send(notFound(key));
    return reply.type('text/html').send(entityDetail(entity));
  });

  // ── Governance overview (live-DB health metrics) ─────────────────────────────
  app.get('/admin/overview', { preHandler: requireSession }, async (_req, reply) => {
    const [byType, dominant, producers, byStatus, byEditable, sections, redirects, facts, audit] = await Promise.all([
      query<{ entity_type: string; n: number }>(
        'SELECT entity_type, count(*)::int AS n FROM entities GROUP BY entity_type ORDER BY n DESC, entity_type',
      ),
      // dominant ownership: entities.source is the single owning source per atom
      query<{ source: string; n: number }>(
        'SELECT source, count(*)::int AS n FROM entities WHERE source IS NOT NULL GROUP BY source',
      ),
      // field-level production: every source named in any entity's provenance map
      query<{ source: string; n: number }>(
        'SELECT src AS source, count(*)::int AS n FROM entities e, jsonb_each_text(e.provenance) AS p(field, src) GROUP BY src',
      ),
      query<{ status: string; n: number }>(
        'SELECT status, count(*)::int AS n FROM pages GROUP BY status ORDER BY status',
      ),
      query<{ editable: boolean; n: number }>('SELECT editable, count(*)::int AS n FROM pages GROUP BY editable'),
      query<{ n: number }>('SELECT count(*)::int AS n FROM page_sections'),
      query<{ n: number }>('SELECT count(*)::int AS n FROM redirects'),
      query<{ n: number }>('SELECT count(*)::int AS n FROM governance_facts'),
      query<{ at: string; actor: string; action: string; target: string; summary: string | null }>(
        "SELECT to_char(at, 'YYYY-MM-DD HH24:MI') AS at, actor, action, target, summary FROM audit_log ORDER BY at DESC LIMIT 15",
      ),
    ]);
    const entities = byType.rows.reduce((s, r) => s + r.n, 0);
    const claims = byType.rows.find((r) => r.entity_type === 'claim')?.n ?? 0;
    const pagesEditable = byEditable.rows.find((r) => r.editable)?.n ?? 0;
    const pagesReadOnly = byEditable.rows.find((r) => !r.editable)?.n ?? 0;
    // Union dominant-owner counts with field-level producer counts so a source that
    // only produces fields (e.g. jvto-db-crew → crew name/bio) is still "in use".
    const owned = new Map(dominant.rows.map((r) => [r.source, r.n]));
    const produced = new Map(producers.rows.map((r) => [r.source, r.n]));
    const sources = [...new Set([...owned.keys(), ...produced.keys()])]
      .map((s) => ({ source: s, owned: owned.get(s) ?? 0, produced: produced.get(s) ?? 0 }))
      .sort((a, b) => b.produced - a.produced || b.owned - a.owned || a.source.localeCompare(b.source));
    const metrics: GovernanceMetrics = {
      totals: {
        entities,
        pages: pagesEditable + pagesReadOnly,
        sections: sections.rows[0]?.n ?? 0,
        redirects: redirects.rows[0]?.n ?? 0,
        facts: facts.rows[0]?.n ?? 0,
        claims,
        sources: sources.length,
      },
      entitiesByType: byType.rows,
      sources,
      pagesByStatus: byStatus.rows,
      pagesEditable,
      pagesReadOnly,
      audit: audit.rows,
    };
    return reply.type('text/html').send(governanceOverview(metrics));
  });

  // ── Page editor ─────────────────────────────────────────────────────────────
  app.get('/admin/pages/*', { preHandler: requireSession }, async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const route = normalizeRoute('/' + rest);
    const html = await editorHtml(reply, route);
    if (html === null) return reply.code(404).type('text/html').send(notFound(route));
    return reply.type('text/html').send(html);
  });

  app.post('/admin/pages/*', { preHandler: requireSession }, async (req, reply) => {
    if (!csrfOk(req)) {
      return reply.code(403).type('text/html').send(layout({ title: 'Error', authed: true, body: '<div class="flash err">Invalid or expired form token — go back and retry.</div>' }));
    }
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const body = (req.body ?? {}) as Record<string, unknown>;
    const marker = rest.lastIndexOf('/sections/');

    let route: string;
    let result: WriteResult;
    if (marker !== -1) {
      route = normalizeRoute('/' + rest.slice(0, marker));
      const sectionType = rest.slice(marker + '/sections/'.length);
      const content: Record<string, unknown> = {};
      if (typeof body['h1'] === 'string') content['h1'] = body['h1'];
      if (typeof body['body_md'] === 'string') content['body_md'] = body['body_md'];
      result = await putSection(route, sectionType, content, ADMIN_ACTOR);
    } else {
      route = normalizeRoute('/' + rest);
      const seo: Record<string, unknown> = {};
      if (typeof body['seo_title'] === 'string') seo['title'] = body['seo_title'];
      if (typeof body['seo_description'] === 'string') seo['description'] = body['seo_description'];
      const fields: { seo?: unknown; h1?: unknown; status?: unknown } = {};
      if (Object.keys(seo).length > 0) fields.seo = seo;
      if (typeof body['h1'] === 'string') fields.h1 = body['h1'];
      if (typeof body['status'] === 'string') fields.status = body['status'];
      result = await patchPage(route, fields, ADMIN_ACTOR);
    }

    const flash: Flash = result.status === 200 ? { ok: true, messages: [] } : { ok: false, messages: violations(result) };
    const html = await editorHtml(reply, route, flash);
    if (html === null) return reply.code(404).type('text/html').send(notFound(route));
    return reply.code(result.status).type('text/html').send(html);
  });

  // ── Publishing ────────────────────────────────────────────────────────────
  app.get('/admin/publishing', { preHandler: requireSession }, async (_req, reply) => {
    const pages = await query<PageRow>(
      'SELECT route, file_group, page_type, title, status, editable FROM pages WHERE editable = true ORDER BY route',
    );
    const sections = await query<{ route: string; section_type: string }>(
      `SELECT p.route, s.section_type FROM page_sections s JOIN pages p ON p.id = s.page_id
         WHERE s.editable = true ORDER BY p.route`,
    );
    const csrf = issueCsrf(reply);
    return reply.type('text/html').send(publishingView(pages.rows, sections.rows, csrf));
  });

  app.post('/admin/publish', { preHandler: requireSession }, async (req, reply) => {
    if (!csrfOk(req)) {
      return reply.code(403).type('text/html').send(layout({ title: 'Error', authed: true, body: '<div class="flash err">Invalid form token.</div>' }));
    }
    // Publish = export the edited jvto_cms back to the seed pack (the reverse of
    // load.sql, via scripts/export-cms-seed.mjs). jvto-web renders that seed —
    // this repo never touches jvto-web.
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const script = fileURLToPath(new URL('../../scripts/export-cms-seed.mjs', import.meta.url));
    const customOut = process.env.CMS_SEED_OUT; // deploy-time override; default output/seed
    const args = customOut ? [script, '--out', customOut] : [script];
    try {
      const { stdout } = await execFileAsync('node', args, { cwd: repoRoot, env: process.env, timeout: 60_000 });
      let diff = '';
      if (!customOut) {
        try {
          diff = (await execFileAsync('git', ['-C', repoRoot, 'diff', '--stat', '--', 'output/seed'], { timeout: 15_000 })).stdout.trim();
        } catch {
          diff = '';
        }
      }
      return reply.type('text/html').send(publishResult({ ok: true, output: stdout.trim(), diff, outDir: customOut ?? 'output/seed' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).type('text/html').send(publishResult({ ok: false, output: message, diff: '', outDir: customOut ?? 'output/seed' }));
    }
  });
}
