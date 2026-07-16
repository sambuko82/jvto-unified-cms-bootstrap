import type { FieldOwnershipRule } from '../domain/types.js';

/**
 * Find the field-ownership rule that governs a given (entityType, fieldPath).
 * An exact fieldPath match wins over a wildcard `*` rule for the same entity
 * type. Returns undefined when no rule applies (the field is unowned).
 */
export function findOwnershipRule(
  rules: FieldOwnershipRule[],
  entityType: string,
  fieldPath: string,
): FieldOwnershipRule | undefined {
  let wildcard: FieldOwnershipRule | undefined;
  for (const rule of rules) {
    if (rule.entityType !== entityType) {
      continue;
    }
    if (rule.fieldPath === fieldPath) {
      return rule;
    }
    if (rule.fieldPath === '*') {
      wildcard = rule;
    }
  }
  return wildcard;
}
