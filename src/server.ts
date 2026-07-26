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
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { parse as parseYaml } from 'yaml';
import { query, closePool, withTransaction } from './db.js';
import { resolvePage, toPublicEntity, normalizeRoute } from './resolvePage.js';
import type { EntityRow } from './resolvePage.js';
import { normalizeSlug } from './integration/canonical.js';
import { requireAdmin } from './auth.js';
import { checkWritePayload } from './factsGate.js';

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

  // ── Write API (admin-only; every write is facts-locked + audited) ───────────
  const ALLOWED_STATUS = new Set(['draft', 'published']);

  // PATCH /pages/<route> — edit page-level fields { seo?, h1?, status? }.
  app.patch('/pages/*', { preHandler: requireAdmin }, async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    if (rest.includes('/sections/')) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Use PUT to edit a section.' });
    }
    const route = normalizeRoute('/' + rest);
    const body = (req.body ?? {}) as { seo?: unknown; h1?: unknown; status?: unknown };

    const setClauses: string[] = [];
    const fieldNames: string[] = [];
    const values: unknown[] = [];
    if (body.seo !== undefined) {
      if (typeof body.seo !== 'object' || body.seo === null || Array.isArray(body.seo)) {
        return reply.code(400).send({ error: 'Bad Request', message: 'seo must be a JSON object.' });
      }
      values.push(JSON.stringify(body.seo));
      setClauses.push(`seo = $${values.length}::jsonb`);
      fieldNames.push('seo');
    }
    if (body.h1 !== undefined) {
      if (typeof body.h1 !== 'string') {
        return reply.code(400).send({ error: 'Bad Request', message: 'h1 must be a string.' });
      }
      values.push(body.h1);
      setClauses.push(`h1 = $${values.length}`);
      fieldNames.push('h1');
    }
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !ALLOWED_STATUS.has(body.status)) {
        return reply.code(400).send({ error: 'Bad Request', message: 'status must be "draft" or "published".' });
      }
      values.push(body.status);
      setClauses.push(`status = $${values.length}`);
      fieldNames.push('status');
    }
    if (setClauses.length === 0) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Provide at least one of seo, h1, status.' });
    }

    // Facts-lock the display copy being written (status is an enum, not copy).
    const gate = await checkWritePayload({ seo: body.seo, h1: body.h1 });
    if (!gate.ok) return reply.code(400).send({ error: 'Facts-lock violation', violations: gate.violations });

    values.push(route);
    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE pages SET ${setClauses.join(', ')}, editable = true WHERE route = $${values.length} RETURNING route`,
        values,
      );
      const rowCount = res.rowCount ?? 0;
      if (rowCount > 0) {
        await client.query(
          'INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)',
          ['admin', 'patch_page', route, `fields: ${fieldNames.join(', ')}`],
        );
      }
      return rowCount;
    });
    if (updated === 0) return reply.code(404).send({ error: 'Not Found', route });
    return { ok: true, route, editable: true, fields: fieldNames };
  });

  // PUT /pages/<route>/sections/<type> — replace a section's content jsonb.
  app.put('/pages/*', { preHandler: requireAdmin }, async (req, reply) => {
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const marker = rest.lastIndexOf('/sections/');
    if (marker === -1) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Expected /pages/<route>/sections/<type>.' });
    }
    const route = normalizeRoute('/' + rest.slice(0, marker));
    const sectionType = rest.slice(marker + '/sections/'.length);
    if (!sectionType) {
      return reply.code(400).send({ error: 'Bad Request', message: 'Missing section type.' });
    }
    const body = (req.body ?? {}) as { content?: unknown };
    const content = body.content;
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      return reply.code(400).send({ error: 'Bad Request', message: 'content must be a JSON object.' });
    }

    const gate = await checkWritePayload(content);
    if (!gate.ok) return reply.code(400).send({ error: 'Facts-lock violation', violations: gate.violations });

    const updated = await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE page_sections SET content = $1::jsonb, editable = true
           WHERE section_type = $2 AND page_id = (SELECT id FROM pages WHERE route = $3)
           RETURNING id`,
        [JSON.stringify(content), sectionType, route],
      );
      const rowCount = res.rowCount ?? 0;
      if (rowCount > 0) {
        await client.query(
          'INSERT INTO audit_log (actor, action, target, summary) VALUES ($1, $2, $3, $4)',
          ['admin', 'put_section', `${route}#${sectionType}`, `keys: ${Object.keys(content).join(', ')}`],
        );
      }
      return rowCount;
    });
    if (updated === 0) {
      return reply.code(404).send({ error: 'Not Found', route, section_type: sectionType });
    }
    return { ok: true, route, section_type: sectionType, editable: true };
  });

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
