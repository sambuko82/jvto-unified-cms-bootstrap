// src/factsGate.ts — HARD facts-lock gate for CMS writes.
//
// A console edit is AUTHORED SSOT — unlike the advisory `page_content` copy that
// resolvePage skips on READ, an edit is enforced. The write path scans the
// SUBMITTED content directly and REJECTS (400) on any violation:
//   1. no private-marked field names in the payload (reuses isPrivateField);
//   2. no forbidden values (governance_facts.forbidden_values) in any submitted
//      string (reuses loadForbiddenValues + findFactsLockViolations);
//   3. positive must-contain: when the copy references a locked topic it must use
//      the canonical value (founding 2015, Ijen screening mandatory, Package Credit).

import { collectStrings, findFactsLockViolations, loadForbiddenValues } from './resolvePage.js';
import { isPrivateField } from './integration/project.js';

export interface FactsGateResult {
  ok: boolean;
  violations: string[];
}

interface PositiveRule {
  label: string;
  topic: RegExp; // fires only when the copy references the topic
  require: RegExp; // …then this canonical value must be present
  message: string;
}

// Topic-triggered so ordinary edits (that never mention these topics) pass freely.
const POSITIVE_RULES: readonly PositiveRule[] = [
  {
    label: 'founding-year',
    topic: /\b(founded|founding|established|establishment|est\.|since\s+\d{4})\b/i,
    require: /\b2015\b/,
    message: 'Founding/establishment copy must state the year 2015.',
  },
  {
    label: 'ijen-health-screening',
    topic: /\b(health|medical)\s+screening\b|\bijen\b[\s\S]{0,40}?\bscreening\b|\bscreening\b[\s\S]{0,40}?\bijen\b/i,
    require: /\bmandatory\b/i,
    message: 'Ijen health-screening copy must state that screening is mandatory.',
  },
  {
    label: 'package-credit',
    topic: /\b(travel|lifetime|package|cancellation)\s+credit\b/i,
    require: /\bpackage\s+credit\b/i,
    message: 'Cancellation/credit copy must use "Package Credit" (not "Travel Credit").',
  },
];

/** Collect the dotted paths of any field whose NAME matches a private marker. */
function collectPrivateFieldPaths(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectPrivateFieldPaths(item, `${path}[${i}]`, hits));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isPrivateField(key)) hits.push(childPath);
      collectPrivateFieldPaths(child, childPath, hits);
    }
  }
}

/** Enforce the facts-lock on a submitted write payload. Empty violations = allowed. */
export async function checkWritePayload(payload: unknown): Promise<FactsGateResult> {
  const violations: string[] = [];

  // 1) private-marked field names
  const privatePaths: string[] = [];
  collectPrivateFieldPaths(payload, '', privatePaths);
  for (const p of privatePaths) violations.push(`private field not allowed: ${p}`);

  // 2) forbidden values across every submitted string
  const strings: string[] = [];
  collectStrings(payload, strings);
  const forbidden = await loadForbiddenValues();
  for (const hit of findFactsLockViolations(strings, forbidden)) {
    violations.push(`forbidden value: ${hit}`);
  }

  // 3) positive must-contain assertions (topic-triggered)
  const joined = strings.join('\n');
  for (const rule of POSITIVE_RULES) {
    if (rule.topic.test(joined) && !rule.require.test(joined)) {
      violations.push(rule.message);
    }
  }

  return { ok: violations.length === 0, violations };
}
