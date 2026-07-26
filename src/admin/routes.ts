// src/admin/routes.ts — the server-rendered admin console (ADR-008).
//
// Session-cookie auth (signed, HttpOnly, SameSite=Strict) + per-form CSRF; edits
// go through the SAME write core as the JSON API (facts-locked, audited).

import { randomBytes } from 'node:crypto';
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
import { loginPage, dashboard, pageEditor, publishingView } from './views.js';
import type { PageRow, GroupBlock, EditorPage, EditorSection, Flash } from './views.js';

const CSRF_COOKIE = 'cms_csrf';
const ADMIN_ACTOR = 'admin-console';

function loadGroupLabels(): Record<string, { label: string }> {
  const p = fileURLToPath(new URL('../../config/pages.yaml', import.meta.url));
  const parsed = parseYaml(readFileSync(p, 'utf8')) as { groups?: Record<string, { label: string }> };
  return parsed.groups ?? {};
}

function issueCsrf(reply: FastifyReply): string {
  const token = randomBytes(16).toString('hex');
  reply.setCookie(CSRF_COOKIE, token, { path: '/admin', httpOnly: true, sameSite: 'strict', signed: true });
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
    if (!csrfOk(req)) return reply.code(403).type('text/html').send(layout({ title: 'Error', authed: true, body: '<div class="flash err">Invalid form token.</div>' }));
    // The actual export→seed publish is wired in the Publish slice (PR 3).
    return reply
      .code(501)
      .type('text/html')
      .send(layout({ title: 'Publishing', authed: true, body: '<div class="flash err">Publishing (export → seed) is wired in the next slice.</div><p><a href="/admin/publishing">Back</a></p>' }));
  });
}
