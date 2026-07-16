import type { PublicationCandidate } from '../domain/types.js';

export interface PublicationGateResult {
  allowed: boolean;
  errors: string[];
}

export function evaluatePublication(candidate: PublicationCandidate): PublicationGateResult {
  const errors: string[] = [];

  if (candidate.workflowStatus !== 'approved' && candidate.workflowStatus !== 'scheduled') {
    errors.push(`Workflow status ${candidate.workflowStatus} is not publishable.`);
  }
  if (candidate.unresolvedBlockingConflicts > 0) {
    errors.push('Unresolved blocking conflicts exist.');
  }
  if (!candidate.approvalsSatisfied) {
    errors.push('Required approvals are missing.');
  }
  if (!candidate.routeSupported) {
    errors.push('The runtime does not support the target route or template.');
  }
  if (candidate.privateFieldLeaks.length > 0) {
    errors.push(`Private fields detected: ${candidate.privateFieldLeaks.join(', ')}`);
  }
  errors.push(...candidate.validationErrors);

  return { allowed: errors.length === 0, errors };
}
