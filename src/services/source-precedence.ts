import type {
  FieldOwnershipRule,
  IncomingFieldChange,
  OwnershipDecision,
} from '../domain/types.js';

export function decideIncomingFieldChange(
  rule: FieldOwnershipRule,
  change: IncomingFieldChange,
): OwnershipDecision {
  if (rule.ownerSource === change.incomingSource) {
    return {
      action: rule.writePolicy === 'override_with_approval' ? 'require_approval' : 'accept',
      severity: 'info',
      reason: 'Incoming value is supplied by the configured owner source.',
    };
  }

  switch (rule.conflictPolicy) {
    case 'block':
      return {
        action: 'block',
        severity: 'blocking',
        reason: `Field is owned by ${rule.ownerSource}; ${change.incomingSource} cannot overwrite it.`,
      };
    case 'warn':
      return {
        action: 'warn',
        severity: 'warning',
        reason: `Non-owner source proposed a different value for ${change.fieldPath}.`,
      };
    case 'prefer_owner':
      return {
        action: 'stage',
        severity: 'info',
        reason: 'Owner value remains active; incoming value is retained as source context.',
      };
    case 'manual_resolution':
      return {
        action: 'require_approval',
        severity: 'blocking',
        reason: 'A reviewer must explicitly resolve this source disagreement.',
      };
    case 'create_new_version':
      return {
        action: 'stage',
        severity: 'info',
        reason: 'Incoming value may be used to create a new draft version without mutating the published value.',
      };
    default: {
      const exhaustive: never = rule.conflictPolicy;
      throw new Error(`Unhandled conflict policy: ${String(exhaustive)}`);
    }
  }
}
