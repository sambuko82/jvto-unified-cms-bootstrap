import { describe, expect, it } from 'vitest';
import { decideIncomingFieldChange } from '../src/services/source-precedence.js';

const base = {
  entityType: 'package',
  fieldPath: 'price_tiers',
  ownerSource: 'postgres-operational',
  writePolicy: 'operational_only' as const,
};

describe('source precedence', () => {
  it('accepts an owner-source value', () => {
    const result = decideIncomingFieldChange(
      { ...base, conflictPolicy: 'block' },
      {
        entityType: 'package',
        fieldPath: 'price_tiers',
        incomingSource: 'postgres-operational',
        ownerSource: 'postgres-operational',
        ownerValue: 100,
        incomingValue: 110,
      },
    );
    expect(result.action).toBe('accept');
  });

  it('blocks a non-owner price overwrite', () => {
    const result = decideIncomingFieldChange(
      { ...base, conflictPolicy: 'block' },
      {
        entityType: 'package',
        fieldPath: 'price_tiers',
        incomingSource: 'llm-wiki-package-readiness',
        ownerSource: 'postgres-operational',
        ownerValue: 100,
        incomingValue: 110,
      },
    );
    expect(result.action).toBe('block');
    expect(result.severity).toBe('blocking');
  });
});
