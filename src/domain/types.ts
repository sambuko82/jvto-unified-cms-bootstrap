import type { ConflictPolicy, ConflictSeverity, WritePolicy, WorkflowStatus } from './enums.js';

export interface SourceSystem {
  code: string;
  role: string;
  authorityRank: number;
  manifestRequired: boolean;
  checksumRequired: boolean;
}

export interface FieldOwnershipRule {
  entityType: string;
  fieldPath: string;
  ownerSource: string;
  writePolicy: WritePolicy;
  conflictPolicy: ConflictPolicy;
  approvalRole?: string;
}

export interface IncomingFieldChange {
  entityType: string;
  fieldPath: string;
  incomingSource: string;
  ownerSource: string;
  ownerValue: unknown;
  incomingValue: unknown;
}

export interface OwnershipDecision {
  action: 'accept' | 'stage' | 'warn' | 'block' | 'require_approval';
  severity: ConflictSeverity;
  reason: string;
}

export interface PublicationCandidate {
  workflowStatus: WorkflowStatus;
  unresolvedBlockingConflicts: number;
  approvalsSatisfied: boolean;
  routeSupported: boolean;
  privateFieldLeaks: string[];
  validationErrors: string[];
}
