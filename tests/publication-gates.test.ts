import { describe, expect, it } from 'vitest';
import { evaluatePublication } from '../src/services/publication-gates.js';

describe('publication gates', () => {
  it('allows a fully approved candidate', () => {
    const result = evaluatePublication({
      workflowStatus: 'approved',
      unresolvedBlockingConflicts: 0,
      approvalsSatisfied: true,
      routeSupported: true,
      privateFieldLeaks: [],
      validationErrors: [],
    });
    expect(result.allowed).toBe(true);
  });

  it('blocks private-field leakage and conflicts', () => {
    const result = evaluatePublication({
      workflowStatus: 'approved',
      unresolvedBlockingConflicts: 1,
      approvalsSatisfied: true,
      routeSupported: true,
      privateFieldLeaks: ['crew.phone'],
      validationErrors: [],
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
