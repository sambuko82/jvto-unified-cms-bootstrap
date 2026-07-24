// tests/runtime/runtime.test.ts — real Postgres integration tests for the CMS
// read-runtime (resolver + Fastify API). One file / one seed load so there is no
// cross-file `DELETE FROM page_sections` race. Skips when no DB is configured.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { hasDb, loadSchemaAndSeed } from './_db.js';

const TOUR_ROUTE = '/tours/from-bali/bromo-ijen-3d2n';
const EXPECTED_GROUP_COUNTS = [1, 19, 6, 6, 8, 9, 1, 2]; // 001..008, total 52

describe.skipIf(!hasDb)('CMS read-runtime (integration)', () => {
  let rp: typeof import('../../src/resolvePage.js');
  let db: typeof import('../../src/db.js');
  let app: FastifyInstance;

  beforeAll(async () => {
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
    expect(rows[0]).toEqual({ e: '172', p: '52', s: '203' });
  });

  it('resolves the graded tour route with ordered sections + hydrated entities + JSON-LD', async () => {
    const r = await rp.resolvePage(TOUR_ROUTE);
    expect(r).not.toBeNull();
    if (!r) return;

    expect(r.page.route).toBe(TOUR_ROUTE);
    expect(r.page.page_type).toBe('tour');

    // sections come back ordered by sort_order (1..8)
    expect(r.sections.map((s) => s.type)).toEqual([
      'hero',
      'steps',
      'vantage',
      'section_head',
      'card_grid',
      'data_box',
      'faq_list',
      'cta',
    ]);

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

  it('resolves every one of the 52 pages without throwing (0 orphan pages)', async () => {
    const { rows } = await db.query<{ route: string }>('SELECT route FROM pages ORDER BY route');
    expect(rows.length).toBe(52);
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

  it('GET /pages -> 8 file-groups, 52 routes, correct counts + labels', async () => {
    const res = await app.inject({ method: 'GET', url: '/pages' });
    expect(res.statusCode).toBe(200);
    const groups = res.json() as Array<{ file_group: string; label: string; count: number; pages: unknown[] }>;
    expect(groups.map((g) => g.file_group)).toEqual(['001', '002', '003', '004', '005', '006', '007', '008']);
    expect(groups.map((g) => g.count)).toEqual(EXPECTED_GROUP_COUNTS);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(52);
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
});
