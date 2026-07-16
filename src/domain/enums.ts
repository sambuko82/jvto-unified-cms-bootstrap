export const WORKFLOW_STATUSES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'scheduled',
  'published',
  'superseded',
  'archived',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const WRITE_POLICIES = [
  'read_only',
  'editable',
  'override_with_approval',
  'operational_only',
  'developer_only',
  'compliance_only',
] as const;

export type WritePolicy = (typeof WRITE_POLICIES)[number];

export const CONFLICT_POLICIES = [
  'block',
  'warn',
  'prefer_owner',
  'manual_resolution',
  'create_new_version',
] as const;

export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number];

export type ConflictSeverity = 'info' | 'warning' | 'blocking';
