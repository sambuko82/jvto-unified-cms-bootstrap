// src/auth.ts — admin authentication for the CMS write API.
//
// The read API is public; every WRITE route is gated by `requireAdmin`, which
// checks `Authorization: Bearer <token>` against the env `CMS_ADMIN_TOKEN` with a
// constant-time compare. The token lives ONLY in the environment — never in the
// repo (CI's check-secrets would fail on a committed literal). docs/07 mandates
// server-side authorization on mutations; this is that gate (a session-cookie
// path is layered on in the admin-UI slice, accepted alongside the bearer token).

import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** The configured admin token, or undefined when the write API is disabled. */
export function adminToken(): string | undefined {
  const token = process.env.CMS_ADMIN_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

/** Constant-time string compare (avoids leaking length/prefix via timing). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** True when the request carries a valid admin bearer token. */
export function hasValidBearer(req: FastifyRequest): boolean {
  const expected = adminToken();
  const provided = bearerToken(req);
  return Boolean(expected && provided && constantTimeEqual(provided, expected));
}

// The admin-console session: a cookie signed with the admin token (see @fastify/cookie).
export const SESSION_COOKIE = 'cms_session';
export const SESSION_VALUE = 'admin';

/** True when the request carries a valid signed admin session cookie. */
export function hasValidSession(req: FastifyRequest): boolean {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === SESSION_VALUE;
}

/** Authenticated by EITHER the bearer token (API) or the session cookie (console). */
export function isAuthenticated(req: FastifyRequest): boolean {
  return hasValidBearer(req) || hasValidSession(req);
}

/**
 * Fastify preHandler: allow only requests with a valid admin bearer token.
 * 503 when the server has no CMS_ADMIN_TOKEN (write API disabled); 401 otherwise.
 * Returns the reply to short-circuit; returns undefined to proceed.
 */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!adminToken()) {
    return reply
      .code(503)
      .send({ error: 'Service Unavailable', message: 'Write API disabled: CMS_ADMIN_TOKEN is not configured.' });
  }
  if (!isAuthenticated(req)) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  return undefined; // authorized — proceed to the handler
}
