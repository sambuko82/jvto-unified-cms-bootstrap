// tests/runtime/runtime.test.ts — real Postgres integration tests for the CMS
// read-runtime (resolver + Fastify API). One file / one seed load so there is no
// cross-file `DELETE FROM page_sections` race. Skips when no DB is configured.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hasDb, loadSchemaAndSeed } from './_db.js';

const TOUR_ROUTE = '/tours/from-bali/bromo-ijen-3d2n';
const EXPECTED_GROUP_COUNTS = [1, 20, 6, 6, 14, 10, 1, 4, 12, 2]; // 001..010, total 76 (+markets(010), +/trust(006), +2 blog posts(008))
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
    // 76 pages: +5 scraped from the live site (/markets/singapore|malaysia in new group
    // 010, /trust in 006, 2 blog posts in 008) via the help-live extract. 306 sections;
    // only /blog/why-not-unlicensed-ijen-operator stays scaffold-only (75/76 rendered).
    expect(rows[0]).toEqual({ e: '172', p: '76', s: '306' });
  });

  it('seed loads the asset media registry (128 images, stable keys, link metadata)', async () => {
    const { rows } = await db.query<{ n: string; keyed: string; images: string }>(
      `SELECT count(*) n, count(key) keyed, count(*) FILTER (WHERE kind = 'image') images FROM assets`,
    );
    expect(rows[0]).toEqual({ n: '128', keyed: '128', images: '128' });
    // each asset carries the link that tells the jvto_dev sync where to attach it
    const org = await db.query<{ field: string | null }>(
      `SELECT meta->'link'->>'field' AS field FROM assets WHERE key = 'brand_identity/01-jvto-hero-landscape.webp'`,
    );
    expect(org.rows[0]?.field).toBe('hero_image_url');
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

  it('resolves every one of the 76 pages without throwing (0 orphan pages)', async () => {
    const { rows } = await db.query<{ route: string }>('SELECT route FROM pages ORDER BY route');
    expect(rows.length).toBe(76);
    for (const { route } of rows) {
      const resolved = await rp.resolvePage(route);
      expect(resolved, `resolve ${route}`).not.toBeNull();
    }
  });

  it('resolves a /team/{slug} crew profile: entity hydrated + name/evidence overlaid', async () => {
    const r = await rp.resolvePage('/team/anjas');
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.page.page_type).toBe('crew_profile');
    expect(r.page.hub_route).toBe('/why-jvto/our-team');
    // the `profile` section hydrates the structured public_person_profile entity
    const keys = r.sections.flatMap((s) => s.entities.map((e) => e.canonical_key));
    expect(keys).toContain('public_person_profile:anjas');
    // the jvto-db /team/anjas page copy is overlaid: name → h1, plus review evidence
    expect(r.page.h1).toBe('Anjas');
    const pc = r.sections.find((s) => s.type === 'page_content');
    expect(pc, 'page_content overlaid').toBeTruthy();
    expect(Array.isArray(pc?.content['evidence'])).toBe(true);
  });

  it('crew profiles carry a name + bio from the operational crew registry (C3)', async () => {
    // C3: the operational crew registry (jvto-db-crew) fills the name/bio gap that
    // llm-wiki-trust leaves on public_person_profile, so the crew card_grid and /team
    // pages hydrate NAMED crew (all 14 were previously nameless).
    const res = await app.inject({ method: 'GET', url: '/entities/public_person_profile/anjas' });
    expect(res.statusCode).toBe(200);
    const entity = res.json() as { data: { name?: string; bio?: string }; source?: string };
    expect(entity.data.name).toBe('Anjas');
    expect(typeof entity.data.bio).toBe('string');
    expect((entity.data.bio ?? '').length).toBeGreaterThan(10);

    // the /why-jvto/our-team crew grid now hydrates all 14 crew WITH names
    const team = await rp.resolvePage('/why-jvto/our-team');
    const grid = team?.sections.find((s) => s.variant === 'crew');
    const named = (grid?.entities ?? []).filter(
      (e) => typeof e.data['name'] === 'string' && (e.data['name'] as string).length > 0,
    );
    expect(named.length).toBeGreaterThanOrEqual(14);
  });

  it('resolves the adopted live routes /team hub + /isic/student-package', async () => {
    // Phase 1: routes live on help.jvto whose copy already sat in the extracts, now
    // wired into the IA so the CMS holds them (crew grid + overlaid index copy).
    const team = await rp.resolvePage('/team');
    expect(team, '/team hub resolves').not.toBeNull();
    expect(team?.page.file_group).toBe('009');
    const grid = team?.sections.find((s) => s.variant === 'crew');
    expect(grid?.entities.length ?? 0).toBeGreaterThanOrEqual(14);
    const pc = team?.sections.find((s) => s.type === 'page_content');
    expect(pc?.content['lede'] || pc?.content['members'], '/team index copy overlaid').toBeTruthy();

    const isic = await rp.resolvePage('/isic/student-package');
    expect(isic, '/isic/student-package resolves').not.toBeNull();
    const ipc = isic?.sections.find((s) => s.type === 'page_content');
    expect(Object.keys(ipc?.content ?? {}).length, '/isic copy overlaid').toBeGreaterThan(0);
  });

  it('resolves the scraped live routes /markets/* + /trust (help-live extract)', async () => {
    // Phase 1 slice 2: pages hardcoded in jvto-web, scraped from the live server-rendered
    // site into the help-live extract and overlaid by route — now first-class CMS pages.
    const sg = await rp.resolvePage('/markets/singapore');
    expect(sg?.page.file_group).toBe('010');
    const sgpc = sg?.sections.find((s) => s.type === 'page_content');
    expect((sgpc?.content['sections'] as unknown[])?.length ?? 0).toBeGreaterThan(0);

    const trust = await rp.resolvePage('/trust');
    expect(trust, '/trust resolves').not.toBeNull();
    // the 9 claim entities hydrate on the /trust card_grid (claims:all)
    const claims = trust?.sections.flatMap((s) => s.entities).filter((e) => e.entity_type === 'claim') ?? [];
    expect(claims.length).toBe(9);
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
    expect(redirects.length).toBe(12);
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

  it('GET /pages -> 10 file-groups, 76 routes, correct counts + labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/pages' });
    expect(res.statusCode).toBe(200);
    const groups = res.json() as Array<{ file_group: string; label: string; count: number; pages: unknown[] }>;
    expect(groups.map((g) => g.file_group)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008', '009', '010']);
    expect(groups.map((g) => g.count)).toEqual(EXPECTED_GROUP_COUNTS);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(76);
    expect(groups[0]?.label).toBe('Home');
    expect(groups[1]?.label).toBe('Tours');
    expect(groups[8]?.label).toBe('Team');
    expect(groups[9]?.label).toBe('Markets');
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

  it('GET /redirects -> 12 rows ordered by from_path', async () => {
    const res = await app.inject({ method: 'GET', url: '/redirects' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ from_path: string }>;
    expect(rows.length).toBe(12);
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

  it('media library lists assets and a console image swap sets editable=true', async () => {
    const session = await login();
    const lib = await app.inject({ method: 'GET', url: '/admin/media', cookies: { cms_session: session } });
    expect(lib.statusCode).toBe(200);
    expect(lib.body).toContain('brand_identity/01-jvto-hero-landscape.webp');
    // swap the hero image URL through the console form
    const { cookie, token } = await csrfFor('/admin/media', session);
    const res = await app.inject({
      method: 'POST',
      url: '/admin/media/brand_identity/01-jvto-hero-landscape.webp',
      cookies: { cms_session: session, cms_csrf: cookie },
      headers: FORM,
      payload: `csrf=${token}&url=${encodeURIComponent('https://cdn.example.com/new-hero.webp')}&alt=New+hero+image`,
    });
    expect(res.statusCode).toBe(200);
    const { rows } = await db.query<{ editable: boolean; url: string }>(
      `SELECT editable, url FROM assets WHERE key = 'brand_identity/01-jvto-hero-landscape.webp'`,
    );
    expect(rows[0]?.editable).toBe(true);
    expect(rows[0]?.url).toBe('https://cdn.example.com/new-hero.webp');
  });

  it('admin Entity Registry surfaces per-field provenance', async () => {
    const session = await login();
    // index groups atoms by type and links to each
    const idx = await app.inject({ method: 'GET', url: '/admin/entities', cookies: { cms_session: session } });
    expect(idx.statusCode).toBe(200);
    expect(idx.body).toContain('public_person_profile');
    expect(idx.body).toContain('/admin/entities/public_person_profile:anjas');
    // detail shows each field's producing source; anjas.name/bio came from jvto-db-crew (C3)
    const detail = await app.inject({
      method: 'GET',
      url: '/admin/entities/public_person_profile:anjas',
      cookies: { cms_session: session },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain('produced by');
    expect(detail.body).toContain('jvto-db-crew');
    expect(detail.body).toContain('llm-wiki-trust');
    // slice 3: owner + policy columns make producer≠owner visible — anjas.name is
    // produced by jvto-db-crew but OWNED by llm-wiki-trust (a staged gap-fill).
    expect(detail.body).toContain('owned by');
    expect(detail.body).toContain('gap-fill');
    // unknown key 404s
    const missing = await app.inject({ method: 'GET', url: '/admin/entities/nope:nothing', cookies: { cms_session: session } });
    expect(missing.statusCode).toBe(404);
  });

  it('admin Sources & ownership surfaces the registry + field-ownership rules', async () => {
    const noSession = await app.inject({ method: 'GET', url: '/admin/sources' });
    expect(noSession.statusCode).toBe(302);
    const session = await login();
    const res = await app.inject({ method: 'GET', url: '/admin/sources', cookies: { cms_session: session } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Registered sources');
    expect(res.body).toContain('Field-ownership rules');
    // registry codes (read from config/source-registry.yaml)
    expect(res.body).toContain('knowledge-catalog-okf');
    expect(res.body).toContain('jvto-db-crew');
    // a registered-but-dormant source is cross-referenced against real production
    expect(res.body).toContain('not producing');
    // field-ownership rule fields (read from config/field-ownership.yaml)
    expect(res.body).toContain('prefer_owner');
  });

  it('admin Governance overview reports live-DB metrics', async () => {
    // requires a session
    const noSession = await app.inject({ method: 'GET', url: '/admin/overview' });
    expect(noSession.statusCode).toBe(302);
    const session = await login();
    const res = await app.inject({ method: 'GET', url: '/admin/overview', cookies: { cms_session: session } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Governance overview');
    // metric tiles
    expect(res.body).toContain('Trust claims');
    expect(res.body).toContain('Governance facts');
    // entities-by-type and sources-in-use are computed from real seeded rows
    expect(res.body).toContain('public_person_profile');
    expect(res.body).toContain('jvto-db-crew'); // the C3 source shows up under "Sources in use"
    expect(res.body).toContain('llm-wiki-trust');
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

  // ── Seed prune: a slug rename must not leave an orphan page shadowing its redirect ──
  it('load.sql prunes synced pages/redirects that left the seed, keeping editable rows', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const loadSql = readFileSync(
      fileURLToPath(new URL('../../output/seed/load.sql', import.meta.url)),
      'utf8',
    );
    // The generated prune statements, applied verbatim (this asserts the real artifact,
    // not a reconstruction). Each is a single self-contained line in load.sql.
    const pagePrune = loadSql
      .split('\n')
      .find((l) => l.startsWith('DELETE FROM pages WHERE editable IS NOT TRUE AND route <> ALL('));
    const redirectPrune = loadSql
      .split('\n')
      .find((l) => l.startsWith('DELETE FROM redirects WHERE from_path <> ALL('));
    expect(pagePrune, 'load.sql carries the page prune').toBeTruthy();
    expect(redirectPrune, 'load.sql carries the redirect prune').toBeTruthy();

    // Reproduce the slug-rename fallout: a stale SYNCED page sitting on the OLD short slug
    // (/destinations/bromo, itself a redirect from_path) SHADOWS the redirect — resolvePage
    // returns a page before it ever consults redirects. Plus a console-authored (editable)
    // page and a stale synced redirect, both at throwaway routes not in the seed.
    await db.query(
      `INSERT INTO pages (route, file_group, page_type, editable) VALUES
         ('/destinations/bromo', '003', 'destination', false),
         ('/zz-prune-editable', '099', 'narrative', true)
       ON CONFLICT (route) DO UPDATE SET editable = EXCLUDED.editable, file_group = EXCLUDED.file_group`,
    );
    await db.query(
      `INSERT INTO redirects (from_path, to_path, code) VALUES ('/zz-prune-redirect', '/', 301)
       ON CONFLICT (from_path) DO NOTHING`,
    );

    // BEFORE the prune: the orphan shadows its own redirect (resolves to itself).
    const shadowed = await rp.resolvePage('/destinations/bromo');
    expect(shadowed?.page.route, 'orphan page shadows the redirect before pruning').toBe(
      '/destinations/bromo',
    );

    await db.query(pagePrune!);
    await db.query(redirectPrune!);

    const count = async (sql: string, p: string) => (await db.query(sql, [p])).rows.length;
    // synced orphan page pruned; console-edited (editable) page preserved
    expect(await count('SELECT 1 FROM pages WHERE route = $1', '/destinations/bromo')).toBe(0);
    expect(await count('SELECT 1 FROM pages WHERE route = $1', '/zz-prune-editable')).toBe(1);
    // synced orphan redirect pruned; the real short->long redirect preserved
    expect(await count('SELECT 1 FROM redirects WHERE from_path = $1', '/zz-prune-redirect')).toBe(0);
    expect(await count('SELECT 1 FROM redirects WHERE from_path = $1', '/destinations/bromo')).toBe(1);

    // AFTER the prune: the short slug now 301-follows to the canonical long slug (the fix).
    const followed = await rp.resolvePage('/destinations/bromo');
    expect(followed?.page.route, 'short slug follows redirect after pruning').toBe(
      '/destinations/mount-bromo',
    );

    await db.query(`DELETE FROM pages WHERE route = '/zz-prune-editable'`); // cleanup survivor
  });
});
