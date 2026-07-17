import { createHash } from 'node:crypto';

/**
 * Deterministic JSON serialization (recursively sorted object keys) so that a
 * payload hash is stable regardless of key insertion order. Arrays keep order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      out[key] = sortValue(input[key]);
    }
    return out;
  }
  return value;
}

/** sha256 hex of a UTF-8 string. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** sha256 hex of a payload's canonical JSON — the `payloadSha256` contract. */
export function payloadHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

/**
 * Normalize any of the multi-form JVTO slugs to a bare, lowercase, dash slug:
 *   "tours/from-surabaya/bromo-1d1n" -> "bromo-1d1n"
 *   "bali/bromo-ijen-3d2n"           -> "bromo-ijen-3d2n"
 *   "SUB-3D2N-BROMO-IJEN"            -> "sub-3d2n-bromo-ijen"
 *   "/#agung-sambuko"               -> "agung-sambuko"
 *   "Kawah Ijen"                     -> "kawah-ijen"
 */
export function normalizeSlug(raw: string): string {
  let slug = raw.trim();
  // take the last path segment for full-path / origin-prefixed forms
  if (slug.includes('/')) {
    const parts = slug.split('/').filter((p) => p.length > 0 && p !== '#');
    slug = parts[parts.length - 1] ?? slug;
  }
  slug = slug.replace(/^#/, '');
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Resolve a stable `<type>:<slug>` canonical key for a record. An explicit
 * `canonicalKey` on the record is trusted; otherwise the alias table is
 * consulted (by raw or normalized externalKey) and finally the slug is derived.
 */
export function resolveCanonicalKey(
  entityType: string,
  externalKey: string,
  explicit?: string | null,
  aliases: Record<string, string> = {},
): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const direct = aliases[externalKey];
  if (direct) {
    return direct;
  }
  const slug = normalizeSlug(externalKey);
  const aliased = aliases[slug];
  if (aliased) {
    return aliased;
  }
  return `${entityType}:${slug}`;
}
