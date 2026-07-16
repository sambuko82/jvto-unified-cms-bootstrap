import type { ConflictSeverity } from '../domain/enums.js';
import type { FieldOwnershipRule, OwnershipDecision } from '../domain/types.js';
import type { SourceReleaseManifest } from '../contracts/sourceRelease.js';
import type { PublicationManifest } from '../contracts/publication.js';

/**
 * A single imported record as it lands in the staging zone
 * (mirror of schemas/import-record.schema.json).
 */
export interface ImportRecord {
  source: string;
  releaseVersion: string;
  externalKey: string;
  entityType: string;
  canonicalKey?: string | null;
  payload: Record<string, unknown>;
  payloadSha256: string;
  status?: string;
}

/** The bytes of every file named in a manifest, keyed by manifest `path`. */
export type ReleaseFileBytes = Record<string, string>;

/** A source release paired with the raw bytes of its files (a "bundle"). */
export interface ReleaseBundle {
  manifest: SourceReleaseManifest;
  files: ReleaseFileBytes;
  records: ImportRecord[];
}

export interface ChecksumIssue {
  path: string;
  expected: string;
  actual: string;
}

export interface ManifestVerification {
  ok: boolean;
  issues: ChecksumIssue[];
}

/** One field-level disagreement between the current owner value and an incoming value. */
export interface FieldDiff {
  fieldPath: string;
  ownerValue: unknown;
  incomingValue: unknown;
}

/** The active canonical value for an entity field, used as the owner side of a diff. */
export interface OwnerFieldValue {
  ownerSource: string;
  value: unknown;
}

/**
 * A lookup of the current owner value for a given (canonicalKey, fieldPath).
 * The pipeline seeds it from prior promoted state; empty means "new entity".
 */
export type OwnerValueLookup = (
  canonicalKey: string,
  fieldPath: string,
) => OwnerFieldValue | undefined;

export interface RecordConflict {
  canonicalKey: string;
  entityType: string;
  fieldPath: string;
  incomingSource: string;
  ownerSource: string;
  severity: ConflictSeverity;
  reason: string;
  ownerValue: unknown;
  incomingValue: unknown;
}

/** The result of mapping one import record against the ownership registry. */
export interface MappedRecord {
  record: ImportRecord;
  canonicalKey: string;
  decisions: Array<{ fieldPath: string; decision: OwnershipDecision }>;
  conflicts: RecordConflict[];
  /** true when no field on this record produced a blocking conflict */
  clean: boolean;
}

/** A canonical entity projected from all clean, owned fields across records. */
export interface ProjectedEntity {
  canonicalKey: string;
  entityType: string;
  /** map of fieldPath -> { value, source } for every accepted/staged field */
  fields: Record<string, { value: unknown; source: string }>;
  /** the highest-authority route this entity publishes to, if any */
  route?: string;
}

export interface ConsolidationInput {
  bundles: ReleaseBundle[];
  rules: FieldOwnershipRule[];
  /** authority_rank by source code, from the source registry */
  authorityBySource: Record<string, number>;
  /** optional map of aliases -> canonicalKey to help key resolution */
  aliases?: Record<string, string>;
  /** optional prior owner state (promoted values) for diffing */
  ownerLookup?: OwnerValueLookup;
  /** identifiers used to stamp the publication manifest */
  actorId: string;
  approverIds?: string[];
  publicationId: string;
  publishedAt: string;
}

export interface ConsolidationResult {
  verifications: Array<{ source: string; version: string } & ManifestVerification>;
  mapped: MappedRecord[];
  conflicts: RecordConflict[];
  entities: ProjectedEntity[];
  publication: PublicationManifest;
}
