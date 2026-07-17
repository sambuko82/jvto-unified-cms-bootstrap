import type { FieldOwnershipRule } from '../domain/types.js';
import { decideIncomingFieldChange } from '../services/source-precedence.js';
import { canonicalJson, resolveCanonicalKey } from './canonical.js';
import { findOwnershipRule } from './ownership.js';
import type {
  ImportRecord,
  MappedRecord,
  OwnerValueLookup,
  RecordConflict,
} from './types.js';

/** Fields never treated as content (identity/metadata carried on the payload). */
const IDENTITY_FIELDS = new Set(['id', 'canonical_key', 'canonicalKey', 'schema_version']);

function flattenTopLevel(payload: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(payload).filter(([key]) => !IDENTITY_FIELDS.has(key));
}

/**
 * Map one import record against the ownership registry:
 *  - resolve its canonical key,
 *  - for each content field decide (via decideIncomingFieldChange) whether the
 *    incoming value is accepted / staged / warned / blocked / needs approval,
 *  - collect any non-`accept`, non-`stage` decision as a RecordConflict.
 *
 * When no rule owns a field, an unowned field from a manifest-backed source is
 * accepted as source context (staged), never silently promoted over an owner.
 */
export function mapRecord(
  record: ImportRecord,
  rules: FieldOwnershipRule[],
  aliases: Record<string, string>,
  ownerLookup: OwnerValueLookup | undefined,
): MappedRecord {
  const canonicalKey = resolveCanonicalKey(
    record.entityType,
    record.externalKey,
    record.canonicalKey ?? null,
    aliases,
  );

  const decisions: MappedRecord['decisions'] = [];
  const conflicts: RecordConflict[] = [];

  for (const [fieldPath, incomingValue] of flattenTopLevel(record.payload)) {
    const rule = findOwnershipRule(rules, record.entityType, fieldPath);
    if (!rule) {
      // Unowned field: retain as source context, never overwrite an owner.
      decisions.push({
        fieldPath,
        decision: {
          action: 'stage',
          severity: 'info',
          reason: 'No ownership rule; retained as source context.',
        },
      });
      continue;
    }

    const owner = ownerLookup?.(canonicalKey, fieldPath);
    const ownerValue = owner ? owner.value : undefined;

    const effectiveRule: FieldOwnershipRule = { ...rule, fieldPath };
    const decision = decideIncomingFieldChange(effectiveRule, {
      entityType: record.entityType,
      fieldPath,
      incomingSource: record.source,
      ownerSource: rule.ownerSource,
      ownerValue,
      incomingValue,
    });
    decisions.push({ fieldPath, decision });

    if (decision.action === 'block' || decision.action === 'require_approval' || decision.action === 'warn') {
      // Only record a real disagreement when the incoming value actually differs
      // from a known owner value (or the owner value is unknown/new).
      const differs =
        ownerValue === undefined || canonicalJson(ownerValue) !== canonicalJson(incomingValue);
      if (differs) {
        conflicts.push({
          canonicalKey,
          entityType: record.entityType,
          fieldPath,
          incomingSource: record.source,
          ownerSource: rule.ownerSource,
          severity: decision.severity,
          reason: decision.reason,
          ownerValue,
          incomingValue,
        });
      }
    }
  }

  const clean = !conflicts.some((c) => c.severity === 'blocking');
  return { record, canonicalKey, decisions, conflicts, clean };
}
