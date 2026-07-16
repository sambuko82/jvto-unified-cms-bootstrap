import { describe, expect, it } from 'vitest';
import { findOwnershipRule } from '../../src/integration/ownership.js';
import { mapRecord } from '../../src/integration/mapper.js';
import type { FieldOwnershipRule } from '../../src/domain/types.js';
import type { ImportRecord } from '../../src/integration/types.js';

const rules: FieldOwnershipRule[] = [
  { entityType: 'package', fieldPath: 'price_tiers', ownerSource: 'postgres-operational', writePolicy: 'operational_only', conflictPolicy: 'block' },
  { entityType: 'package', fieldPath: 'route_sequence', ownerSource: 'itinerary-core', writePolicy: 'read_only', conflictPolicy: 'prefer_owner' },
  { entityType: 'review', fieldPath: 'rating_summary', ownerSource: 'canonical-facts', writePolicy: 'compliance_only', conflictPolicy: 'block' },
];

const mk = (source: string, entityType: string, payload: Record<string, unknown>): ImportRecord => ({
  source,
  releaseVersion: '1',
  externalKey: 'bali/bromo-ijen-3d2n',
  entityType,
  canonicalKey: `${entityType}:bromo-ijen-3d2n`,
  payload,
  payloadSha256: '0'.repeat(64),
});

describe('ownership rule matching', () => {
  it('prefers an exact field rule over a wildcard', () => {
    const withWildcard: FieldOwnershipRule[] = [
      { entityType: 'route', fieldPath: '*', ownerSource: 'itinerary-core', writePolicy: 'read_only', conflictPolicy: 'prefer_owner' },
      { entityType: 'route', fieldPath: 'feasibility', ownerSource: 'itinerary-core', writePolicy: 'read_only', conflictPolicy: 'block' },
    ];
    expect(findOwnershipRule(withWildcard, 'route', 'feasibility')?.conflictPolicy).toBe('block');
    expect(findOwnershipRule(withWildcard, 'route', 'other')?.conflictPolicy).toBe('prefer_owner');
  });
});

describe('record mapping', () => {
  it('blocks a non-owner overwriting an owned price field', () => {
    const m = mapRecord(
      mk('design-system', 'package', { price_tiers: [{ pax: 2, idr: 1550000 }] }),
      rules,
      {},
      (key, field) => (field === 'price_tiers' ? { ownerSource: 'postgres-operational', value: [{ pax: 2, idr: 1400000 }] } : undefined),
    );
    expect(m.clean).toBe(false);
    expect(m.conflicts.some((c) => c.fieldPath === 'price_tiers' && c.severity === 'blocking')).toBe(true);
  });

  it('accepts the owner source value', () => {
    const m = mapRecord(mk('itinerary-core', 'package', { route_sequence: ['a', 'b'] }), rules, {}, undefined);
    expect(m.clean).toBe(true);
    expect(m.decisions.find((d) => d.fieldPath === 'route_sequence')?.decision.action).toBe('accept');
  });

  it('lets the adjudicated facts source block a contradicting review figure', () => {
    const m = mapRecord(
      mk('llm-wiki-trust', 'review', { rating_summary: { trustpilot: '4.9/47' } }),
      rules,
      {},
      () => ({ ownerSource: 'canonical-facts', value: { trustpilot: '4.8/51' } }),
    );
    expect(m.clean).toBe(false);
    expect(m.conflicts[0]?.ownerSource).toBe('canonical-facts');
  });

  it('stages an unowned field as source context', () => {
    const m = mapRecord(mk('itinerary-core', 'package', { public_url: '/tours/from-bali/bromo-ijen-3d2n' }), rules, {}, undefined);
    expect(m.clean).toBe(true);
    expect(m.decisions.find((d) => d.fieldPath === 'public_url')?.decision.action).toBe('stage');
  });
});
