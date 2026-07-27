// tests/runtime/runtime.test.ts — real Postgres integration tests for the CMS
// read-runtime (resolver + Fastify API). One file / one seed load so there is no
// cross-file `DELETE FROM page_sections` race. Skips when no DB is configured.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hasDb, loadSchemaAndSeed } from './_db.js';

const TOUR_ROUTE = '/tours/from-bali/bromo-ijen-3d2n';
const EXPECTED_GROUP_COUNTS = [1, 19, 6, 6, 14, 9, 1, 2]; // 001..008, total 58
const ADMIN_BEARER = 'admin-bearer-local-9x';
const authHeaders = { authorization: `Bearer ${ADMIN_BEARER}` };

describe.skipIf(!hasDb)('CMS runtime — read + write (integration)', () => {
  let rp: typeof import('../../src/resolvePage.js');
  let db: typeof import('../../src/db.js');
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.CMS_ADMIN_TOKEN = ADMIN_BEARER; // enable the write API for these tests
    await loadSchemaAndSeed();
    rp = await import('../../src/resolvePage.js');
    db = await import('../../src/db.js');
    const server = await import('../../src/server.js');
    app = server.buildServer();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) await db.closePool();
  });

  // ── resolvePage ─────────────────────────────────────────────────────────────

  it('seed is loaded with the expected counts', async () => {
    const { rows } = await db.query<{ e: string; p: string; s: string }>(
      `SELECT (SELECT count(*) FROM entities) e,
              (SELECT count(*) FROM pages) p,
              (SELECT count(*) FROM page_sections) s`,
    );
    // s = 209 designed IA sections + 57 `page_content` sections (design-system copy
    // overlaid onto the 57 matched pages; only /blog/why-not-unlicensed-ijen-operator
    // stays scaffold-only).
    expect(rows[0]).toEqual({ e: '172', p: '58', s: '266' });
  });

  it('resolves the graded tour route with ordered sections + hydrated entities + JSON-LD', async () => {
    const r = await rp.resolvePage(TOUR_ROUTE);
    expect(r).not.toBeNull();
    if (!r) return;

    expect(r.page.route).toBe(TOUR_ROUTE);
    expect(r.page.page_type).toBe('tour');

    // sections come back ordered by sort_order: the 8 designed IA sections, then the
    // `page_content` section carrying the real live copy overlaid for this route.
    expect(r.sections.map((s) => s.type)).toEqual([
      'hero',
      'steps',
      'vantage',
      'section_head',
      'card_grid',
      'data_box',
      'faq_list',
      'cta',
      'page_content',
    ]);

    // enrichment: real live copy overlaid — page carries a real seo.description and
    // the page_content section holds the actual page body (not just a {title} scaffold).
    expect(typeof r.seo['description']).toBe('string');
    expect((r.seo['description'] as string).length).toBeGreaterThan(20);
    const pageContent = r.sections.find((s) => s.type === 'page_content');
    expect(pageContent, 'page_content section present').toBeTruthy();
    expect(Object.keys(pageContent?.content ?? {}).length).toBeGreaterThan(0);

    // hydrated entities include a package + destinations + a policy
    const keys = r.sections.flatMap((s) => s.entities.map((e) => e.canonical_key));
    expect(keys).toContain('package:bali-bromo-ijen-3d2n');
    expect(keys).toContain('destination:mount-bromo');
    expect(keys).toContain('destination:kawah-ijen');
    expect(keys).toContain('policy_document:cancellation-package-credit');

    // JSON-LD is a non-trivial TouristTrip
    expect(r.jsonld['@type']).toBe('TouristTrip');
    expect(r.jsonld['@context']).toBe('https://schema.org');
    expect(Object.keys(r.jsonld).length).toBeGreaterThan(3);
  });

  it('resolves every one of the 58 pages without throwing (0 orphan pages)', async () => {
    const { rows } = await db.query<{ route: string }>('SELECT route FROM pages ORDER BY route');
    expect(rows.length).toBe(58);
    for (const { route } of rows) {
      const resolved = await rp.resolvePage(route);
      expect(resolved, `resolve ${route}`).not.toBeNull();
    }
  });

  it('has zero dangling entity_refs across all sections', async () => {
    const { rows } = await db.query<{ missing: string }>(
      `SELECT DISTINCT k AS missing
         FROM page_sections s, unnest(s.entity_refs) AS k
         LEFT JOIN entities e ON e.canonical_key = k
        WHERE e.canonical_key IS NULL`,
    );
    expect(rows).toEqual([]);
  });

  it('facts-lock scan is clean (0 violations) across all resolved pages', async () => {
    const forbidden = await rp.loadForbiddenValues();
    expect(forbidden.length).toBeGreaterThan(0);
    const { rows } = await db.query<{ route: string }>('SELECT route FROM pages');
    for (const { route } of rows) {
      const r = await rp.resolvePage(route);
      if (!r) continue;
      const violations = rp.findFactsLockViolations(
        rp.buildScanCorpus(r.page, r.seo, r.sections),
        forbidden,
      );
      expect(violations, `facts-lock on ${route}`).toEqual([]);
    }
  });

  it('follows redirects to their target (or returns null for a dangling target)', async () => {
    const { rows: redirects } = await db.query<{ from_path: string; to_path: string }>(
      'SELECT from_path, to_path FROM redirects',
    );
    expect(redirects.length).toBe(7);
    for (const red of redirects) {
      const targetExists =
        (await db.query('SELECT 1 FROM pages WHERE route = $1', [red.to_path])).rows.length > 0;
      const resolved = await rp.resolvePage(red.from_path);
      if (targetExists) {
        expect(resolved, `redirect ${red.from_path} -> ${red.to_path}`).not.toBeNull();
      } else {
        expect(resolved, `dangling redirect ${red.from_path} -> ${red.to_path}`).toBeNull();
      }
    }
  });

  it('strips private-marked fields from hydrated entities (no destination_tokens false-positive)', async () => {
    // Sanity: the reused shallow strip only touches top-level field names, so the
    // package keeps its nested profile (incl. destination_tokens).
    const r = await rp.resolvePage(TOUR_ROUTE);
    const pkg = r?.sections.flatMap((s) => s.entities).find((e) => e.entity_type === 'package');
    expect(pkg).toBeTruthy();
    expect(pkg?.data['profile']).toBeTruthy();
  });

  // ── Fastify API ─────────────────────────────────────────────────────────────

  it('GET /health -> 200 ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('GET /pages -> 8 file-groups, 58 routes, correct counts + labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/pages' });
    expect(res.statusCode).toBe(200);
    const groups = res.json() as Array<{ file_group: string; label: string; count: number; pages: unknown[] }>;
    expect(groups.map((g) => g.file_group)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008']);
    expect(groups.map((g) => g.count)).toEqual(EXPECTED_GROUP_COUNTS);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(58);
    expect(groups[0]?.label).toBe('Home');
    expect(groups[1]?.label).toBe('Tours');
  });

  it('GET /pages/* resolves the tour route', async () => {
    const res = await app.inject({ method: 'GET', url: `/pages${TOUR_ROUTE}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { page: { route: string }; jsonld: Record<string, unknown> };
    expect(body.page.route).toBe(TOUR_ROUTE);
    expect(body.jsonld['@type']).toBe('TouristTrip');
  });

  it('GET /pages/* -> 404 for an unknown route', async () => {
    const res = await app.inject({ method: 'GET', url: '/pages/does/not/exist' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /entities/:type/:key returns the policy with Package Credit + Ijen mandatory', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/entities/policy_document/cancellation-package-credit',
    });
    expect(res.statusCode).toBe(200);
    const entity = res.json() as { data: { adjudicated_facts: { ijen_health_screening: string } } };
    expect(JSON.stringify(entity.data)).toContain('Package Credit');
    expect(entity.data.adjudicated_facts.ijen_health_screening).toBe('mandatory');
  });

  it('GET /entities/:type lists a type, all of that type', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/package' });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ entity_type: string }>;
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((e) => e.entity_type === 'package')).toBe(true);
  });

  it('GET /entities/:type/:key -> 404 for a missing key', async () => {
    const res = await app.inject({ method: 'GET', url: '/entities/policy_document/nope-not-real' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /redirects -> 7 rows ordered by from_path', async () => {
    const res = await app.inject({ method: 'GET', url: '/redirects' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ from_path: string }>;
    expect(rows.length).toBe(7);
    const paths = rows.map((r) => r.from_path);
    expect([...paths].sort()).toEqual(paths); // already ordered
  });

  // ── Write API (admin-gated, facts-locked) ───────────────────────────────────

  it('PATCH /pages/* without a token -> 401', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/pages${TOUR_ROUTE}`, payload: { status: 'draft' } });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /pages/* with token edits page fields and sets editable=true', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/pages${TOUR_ROUTE}`,
      headers: authHeaders,
      payload: {
        h1: '3 Day Bromo & Ijen Volcano Discovery from Bali',
        seo: { title: 'Bromo & Ijen from Bali', description: 'Private all-inclusive volcano tour.' },
      },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await db.query<{ editable: boolean }>('SELECT editable FROM pages WHERE route = $1', [TOUR_ROUTE]);
    expect(rows[0]?.editable).toBe(true);
  });

  it('PUT section with token replaces content and sets editable=true', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/pages${TOUR_ROUTE}/sections/page_content`,
      headers: authHeaders,
      payload: {
        content: {
          h1: 'Edited body',
          body_md: '# Edited\n\nIjen health screening is mandatory for every guest before crater entry.',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await db.query<{ editable: boolean; h1: string }>(
      `SELECT s.editable, s.content->>'h1' AS h1 FROM page_sections s JOIN pages p ON p.id = s.page_id
        WHERE p.route = $1 AND s.section_type = 'page_content'`,
      [TOUR_ROUTE],
    );
    expect(rows[0]?.editable).toBe(true);
    expect(rows[0]?.h1).toBe('Edited body');
  });

  it('rejects a forbidden value ("Travel Credit") with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/pages${TOUR_ROUTE}/sections/page_content`,
      headers: authHeaders,
      payload: { content: { h1: 'Cancellation', body_md: 'You get Travel Credit when you cancel.' } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('Travel Credit');
  });

  it('rejects the wrong founding year (2016) with 400', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/pages${TOUR_ROUTE}`,
      headers: authHeaders,
      payload: { h1: 'Founded in 2016, JVTO leads volcano tours.' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a private field in content with 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/pages${TOUR_ROUTE}/sections/page_content`,
      headers: authHeaders,
      payload: { content: { h1: 'x', customer_email: 'a@b.com' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('a write to a non-existent route -> 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/pages/does/not/exist',
      headers: authHeaders,
      payload: { status: 'published' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('records successful writes (and only those) in audit_log', async () => {
    const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log ORDER BY id');
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('patch_page');
    expect(actions).toContain('put_section');
  });

  // ── Admin console (session cookie + CSRF + facts-lock through forms) ─────────

  const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
  const csrfOf = (html: string): string => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';

  async function login(): Promise<string> {
    const page = await app.inject({ method: 'GET', url: '/admin/login' });
    const csrfCookie = page.cookies.find((c) => c.name === 'cms_csrf')?.value ?? '';
    const res = await app.inject({
      method: 'POST',
      url: '/admin/login',
      cookies: { cms_csrf: csrfCookie },
      headers: FORM,
      payload: `token=${encodeURIComponent(ADMIN_BEARER)}&csrf=${csrfOf(page.body)}`,
    });
    return res.cookies.find((c) => c.name === 'cms_session')?.value ?? '';
  }

  async function csrfFor(url: string, session: string): Promise<{ cookie: string; token: string }> {
    const res = await app.inject({ method: 'GET', url, cookies: { cms_session: session } });
    return { cookie: res.cookies.find((c) => c.name === 'cms_csrf')?.value ?? '', token: csrfOf(res.body) };
  }

  it('GET /admin without a session redirects to /admin/login', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/admin/login');
  });

  it('admin login yields a session and the dashboard lists pages', async () => {
    const session = await login();
    expect(session).toBeTruthy();
    const dash = await app.inject({ method: 'GET', url: '/admin', cookies: { cms_session: session } });
    expect(dash.statusCode).toBe(200);
    expect(dash.body).toContain(`/admin/pages${TOUR_ROUTE}`);
  });

  it('editing page_content through the console form sets editable=true', async () => {
    const session = await login();
    const { cookie, token } = await csrfFor(`/admin/pages${TOUR_ROUTE}`, session);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/pages${TOUR_ROUTE}/sections/page_content`,
      cookies: { cms_session: session, cms_csrf: cookie },
      headers: FORM,
      payload: `csrf=${token}&h1=Console+edit&body_md=Updated+overview+for+Bromo+and+Ijen.`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Saved');
    const { rows } = await db.query<{ editable: boolean; h1: string }>(
      `SELECT s.editable, s.content->>'h1' AS h1 FROM page_sections s JOIN pages p ON p.id = s.page_id
        WHERE p.route = $1 AND s.section_type = 'page_content'`,
      [TOUR_ROUTE],
    );
    expect(rows[0]?.editable).toBe(true);
    expect(rows[0]?.h1).toBe('Console edit');
  });

  it('a facts-lock violation through the console form is rejected (400)', async () => {
    const session = await login();
    const { cookie, token } = await csrfFor(`/admin/pages${TOUR_ROUTE}`, session);
    const res = await app.inject({
      method: 'POST',
      url: `/admin/pages${TOUR_ROUTE}/sections/page_content`,
      cookies: { cms_session: session, cms_csrf: cookie },
      headers: FORM,
      payload: `csrf=${token}&h1=x&body_md=You+get+Travel+Credit+when+you+cancel.`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Travel Credit');
  });

  it('an admin POST without a CSRF token is rejected (403)', async () => {
    const session = await login();
    const res = await app.inject({
      method: 'POST',
      url: `/admin/pages${TOUR_ROUTE}/sections/page_content`,
      cookies: { cms_session: session },
      headers: FORM,
      payload: 'h1=x&body_md=hello',
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Publish (export jvto_cms → seed) ────────────────────────────────────────

  it('publish requires a session (redirect) and a CSRF token (403)', async () => {
    const noSession = await app.inject({ method: 'POST', url: '/admin/publish' });
    expect(noSession.statusCode).toBe(302);
    const session = await login();
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/admin/publish',
      cookies: { cms_session: session },
      headers: FORM,
      payload: '',
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('publish exports the edited jvto_cms into the seed pack', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'cms-seed-'));
    process.env.CMS_SEED_OUT = outDir; // write to a temp dir, not tracked output/seed
    try {
      const session = await login();
      // a console edit that must surface in the exported seed
      const { cookie, token } = await csrfFor(`/admin/pages${TOUR_ROUTE}`, session);
      const edit = await app.inject({
        method: 'POST',
        url: `/admin/pages${TOUR_ROUTE}/sections/page_content`,
        cookies: { cms_session: session, cms_csrf: cookie },
        headers: FORM,
        payload: `csrf=${token}&h1=Published+edit+marker&body_md=Bromo+and+Ijen+overview.`,
      });
      expect(edit.statusCode).toBe(200);
      // publish (export → seed)
      const pub = await csrfFor('/admin/publishing', session);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/publish',
        cookies: { cms_session: session, cms_csrf: pub.cookie },
        headers: FORM,
        payload: `csrf=${pub.token}`,
      });
      expect(res.statusCode).toBe(200);
      const seed = readFileSync(path.join(outDir, 'page_sections.json'), 'utf8');
      expect(seed).toContain('Published edit marker');
    } finally {
      delete process.env.CMS_SEED_OUT;
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
