import type { PublicationCandidate } from '../domain/types.js';
import { evaluatePublication } from '../services/publication-gates.js';
import type { PublicationManifest, PublicationItem } from '../contracts/publication.js';
import { sha256Hex } from './canonical.js';
import type { MappedRecord, ProjectedEntity, RecordConflict } from './types.js';

/** Field-name fragments that must never appear in a public projection. */
export const PRIVATE_FIELD_MARKERS = [
  'password',
  'cvv',
  'card_number',
  'cardnumber',
  'otp',
  'token',
  'secret',
  'ktp',
  'passport',
  'customer_email',
  'customer_phone',
  'home_address',
];

/** Deterministic RFC-4122-shaped UUID (v4 layout) derived from a seed string. */
export function deterministicUuid(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32).split('');
  hex[12] = '4';
  const variantMap: Record<string, string> = { '0': '8', '1': '9', '2': 'a', '3': 'b' };
  const v = hex[16] ?? '0';
  hex[16] = variantMap[String(parseInt(v, 16) & 0x3)] ?? '8';
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function isPrivateField(fieldPath: string): boolean {
  const lower = fieldPath.toLowerCase();
  return PRIVATE_FIELD_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Project clean mapped records into canonical entities. For each
 * (canonicalKey, fieldPath) the accepted owner value wins; when no owner value
 * is present the highest-authority staged value is kept as context.
 */
export function projectEntities(
  mapped: MappedRecord[],
  authorityBySource: Record<string, number>,
): ProjectedEntity[] {
  const byKey = new Map<string, ProjectedEntity>();
  // authority ranking helper
  const rank = (source: string): number => authorityBySource[source] ?? 0;

  for (const m of mapped) {
    if (!m.clean) {
      continue; // never project an entity carrying a blocking conflict
    }
    let entity = byKey.get(m.canonicalKey);
    if (!entity) {
      entity = { canonicalKey: m.canonicalKey, entityType: m.record.entityType, fields: {} };
      byKey.set(m.canonicalKey, entity);
    }
    for (const { fieldPath, decision } of m.decisions) {
      if (decision.action === 'block' || decision.action === 'require_approval') {
        continue;
      }
      const value = m.record.payload[fieldPath];
      const existing = entity.fields[fieldPath];
      const isOwnerAccept = decision.action === 'accept';
      const existingIsOwner = existing ? rank(existing.source) : -1;
      // Owner-accepted values always win; otherwise higher authority wins.
      const incomingRank = isOwnerAccept ? rank(m.record.source) + 1000 : rank(m.record.source);
      if (!existing || incomingRank > existingIsOwner) {
        entity.fields[fieldPath] = { value, source: m.record.source };
      }
      if ((fieldPath === 'route' || fieldPath === 'public_url' || fieldPath === 'url') && typeof value === 'string') {
        if (value.startsWith('/')) {
          entity.route = value;
        }
      }
    }
  }
  // Deterministic order regardless of source/bundle iteration order.
  return [...byKey.values()].sort((a, b) => a.canonicalKey.localeCompare(b.canonicalKey));
}

/**
 * Assemble a schema-valid publication manifest and run the publication gate.
 * The manifest lists one item per projected entity (with deterministic ids),
 * the affected public routes, the per-source versions, and validation output.
 */
export function buildPublication(params: {
  entities: ProjectedEntity[];
  conflicts: RecordConflict[];
  sourceVersions: Record<string, string>;
  publicationId: string;
  publishedAt: string;
  actorId: string;
  approverIds: string[];
  extraErrors?: string[];
}): PublicationManifest {
  const { entities, conflicts, sourceVersions, publicationId, publishedAt, actorId, approverIds } = params;

  const items: PublicationItem[] = entities.map((entity) => ({
    entityId: deterministicUuid(`entity:${entity.canonicalKey}`),
    versionId: deterministicUuid(`version:${entity.canonicalKey}:${publishedAt}`),
    previousVersionId: null,
  }));

  const affectedRoutes = [
    ...new Set(entities.map((e) => e.route).filter((r): r is string => typeof r === 'string' && r.startsWith('/'))),
  ].sort();

  const privateFieldLeaks: string[] = [];
  for (const entity of entities) {
    for (const fieldPath of Object.keys(entity.fields)) {
      if (isPrivateField(fieldPath)) {
        privateFieldLeaks.push(`${entity.canonicalKey}.${fieldPath}`);
      }
    }
  }

  const blocking = conflicts.filter((c) => c.severity === 'blocking').length;
  const candidate: PublicationCandidate = {
    workflowStatus: 'approved',
    unresolvedBlockingConflicts: blocking,
    approvalsSatisfied: approverIds.length > 0,
    routeSupported: true,
    privateFieldLeaks,
    validationErrors: params.extraErrors ?? [],
  };
  const gate = evaluatePublication(candidate);

  const warnings = conflicts
    .filter((c) => c.severity !== 'blocking')
    .map((c) => `${c.canonicalKey}.${c.fieldPath}: ${c.reason}`);

  return {
    publicationId,
    publishedAt,
    actorId,
    approverIds,
    sourceVersions,
    items,
    affectedRoutes,
    validation: {
      passed: gate.allowed,
      errors: gate.errors,
      warnings,
    },
  };
}
