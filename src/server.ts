// src/server.ts — Fastify read + write API over the CMS core DB (jvto_cms).
//
// Read endpoints (public):
//   GET   /health                          liveness + DB ping
//   GET   /pages                           IA grouped by the 8 file-groups, ordered
//   GET   /pages/*                         resolvePage(route) (routes contain slashes)
//   GET   /entities/:type[/:key]           entities, read-only
//   GET   /redirects                       the redirect table
// Write endpoints (admin bearer token; facts-locked + audited; editable=true):
//   PATCH /pages/<route>                   edit page fields { seo?, h1?, status? }
//   PUT   /pages/<route>/sections/<type>   replace a section's { content }
//
// buildServer() is a factory so tests can drive it with app.inject(); the
// import.meta.url main-guard starts a listener only when run directly.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { parse as parseYaml } from 'yaml';
import { query, closePool } from './db.js';
import { resolvePage, toPublicEntity, normalizeRoute } from './resolvePage.js';
import type { EntityRow } from './resolvePage.js';
import { normalizeSlug } from './integration/canonical.js';
import { requireAdmin, adminToken } from './auth.js';
import { patchPage, putSection } from './writes.js';
import { registerAdmin } from './admin/routes.js';

interface GroupMeta {
  label: string;
  cluster: string;
}

/** Load the 8 file-group labels/clusters from config/pages.yaml (reused IA config). */
function loadGroups(): Record<string, GroupMeta> {
  const configPath = fileURLToPath(new URL('../config/pages.yaml', import.meta.url));
  const parsed = parseYaml(readFileSync(configPath, 'utf8')) as {
    groups?: Record<string, GroupMeta>;
  };
  return parsed.groups ?? {};
}

const ENTITY_COLUMNS =
  'entity_type, canonical_key, slug, title, data, source, editable';

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  // Signed cookies (admin session + CSRF) keyed off the admin token; a random
  // per-start secret when unset (login still requires the token, so no session forms).
  app.register(fastifyCookie, { secret: adminToken() ?? randomBytes(32).toString('hex') });
  app.register(fastifyFormbody); // parse application/x-www-form-urlencoded (admin forms)
  const groups = loadGroups();

  app.get('/health', async (_req, reply) => {
    try {
      await query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      return reply.code(503).send({ status: 'error', message: (err as Error).message });
    }
  });

  app.get('/pages', async () => {
    const { rows } = await query<{
      route: string;
      file_group: string;
      page_type: string;
      title: string | null;
      sort_order: number;
      hub_route: string | null;
      cluster: string | null;
    }>(
      `SELECT route, file_group, page_type, title, sort_order, hub_route, cluster
         FROM pages ORDER BY file_group, sort_order`,
    );
    const order = Object.keys(groups).sort(); // "001".."008"
    return order.map((fileGroup) => {
      const meta = groups[fileGroup];
      const pages = rows
        .filter((r) => r.file_group === fileGroup)
        .map((r) => ({
          route: r.route,
          page_type: r.page_type,
          title: r.title,
          sort_order: r.sort_order,
          hub_route: r.hub_route,
        }));
      return {
        file_group: fileGroup,
        label: meta?.label ?? fileGroup,
        cluster: meta?.cluster ?? null,
        count: pages.length,
        pages,
      };
    });
  });

  // Wildcard: routes contain slashes (e.g. tours/from-bali/bromo-ijen-3d2n).
  app.get('/pages/*', async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const route = normalizeRoute('/' + rest);
    const resolved = await resolvePage(route);
    if (!resolved) return reply.code(404).send({ error: 'Not Found', route });
    return resolved;
  });

  app.get('/entities/:type', async (req) => {
    const { type } = req.params as { type: string };
    const { rows } = await query<EntityRow>(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE entity_type = $1 ORDER BY canonical_key`,
      [type],
    );
    return rows.map(toPublicEntity);
  });

  app.get('/entities/:type/:key', async (req, reply) => {
    const { type, key } = req.params as { type: string; key: string };
    const canonicalKey = `${type}:${normalizeSlug(key)}`;
    const { rows } = await query<EntityRow>(
      `SELECT ${ENTITY_COLUMNS} FROM entities WHERE canonical_key = $1`,
      [canonicalKey],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ error: 'Not Found', canonical_key: canonicalKey });
    return toPublicEntity(row);
  });

  app.get('/redirects', async () => {
    const { rows } = await query<{ from_path: string; to_path: string; code: number }>(
      'SELECT from_path, to_path, code FROM redirects ORDER BY from_path',
    );
    return rows;
  });

  // ── Write API (admin bearer token; delegates to the shared write core) ──────
  // PATCH /pages/<route> — edit page-level fields { seo?, h1?, status? }.
  app.patch('/pages/*', { preHandler: requireAdmin }, async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    if (rest.includes('/sections/')) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Use PUT to edit a section.' });
    }
    const body = (req.body ?? {}) as { seo?: unknown; h1?: unknown; status?: unknown };
    const result = await patchPage('/' + rest, body, 'api');
    return reply.code(result.status).send(result.body);
  });

  // PUT /pages/<route>/sections/<type> — replace a section's content jsonb.
  app.put('/pages/*', { preHandler: requireAdmin }, async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const marker = rest.lastIndexOf('/sections/');
    if (marker === -1) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Expected /pages/<route>/sections/<type>.' });
    }
    const route = '/' + rest.slice(0, marker);
    const sectionType = rest.slice(marker + '/sections/'.length);
    const body = (req.body ?? {}) as { content?: unknown };
    const result = await putSection(route, sectionType, body.content, 'api');
    return reply.code(result.status).send(result.body);
  });

  // ── Admin console (server-rendered; session cookie + CSRF) ──────────────────
  registerAdmin(app);

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not Found' }));
  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return reply.code(500).send({ error: 'Internal Server Error', message });
  });

  return app;
}

// ── Entrypoint (only when executed directly, not when imported by tests) ───────

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is not set — refusing to start the CMS runtime.');
    process.exit(1);
  }
  const app = buildServer();
  const port = Number(process.env.PORT ?? 3000);
  app
    .listen({ port, host: '0.0.0.0' })
    .then((address) => {
      // eslint-disable-next-line no-console
      console.log(`CMS read-runtime listening on ${address}`);
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      await closePool();
      process.exit(1);
    });
}
