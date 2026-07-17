import { verifyManifestChecksums } from './manifest.js';
import { mapRecord } from './mapper.js';
import { buildPublication, projectEntities } from './project.js';
import type { ConsolidationInput, ConsolidationResult, MappedRecord, RecordConflict } from './types.js';

/**
 * Run the full consolidation control-plane pass over a set of release bundles:
 *
 *   verify checksums → map each record against ownership → collect conflicts →
 *   project clean records into canonical entities → build a publication manifest.
 *
 * Pure and deterministic: no network, no filesystem, no clock. The caller
 * supplies the release bundles (which mirror the contents of an immutable
 * GitHub release), the ownership rules, the authority ranking, and the
 * publication identifiers. This is the tested "brain" the jvto-web importer
 * runtime is expected to call once it has downloaded and staged a release.
 */
export function runConsolidation(input: ConsolidationInput): ConsolidationResult {
  const aliases = input.aliases ?? {};
  const verifications: ConsolidationResult['verifications'] = [];
  const mapped: MappedRecord[] = [];
  const conflicts: RecordConflict[] = [];
  const sourceVersions: Record<string, string> = {};
  const extraErrors: string[] = [];

  for (const bundle of input.bundles) {
    const verification = verifyManifestChecksums(bundle.manifest, bundle.files);
    verifications.push({
      source: bundle.manifest.source,
      version: bundle.manifest.version,
      ...verification,
    });
    sourceVersions[bundle.manifest.source] = bundle.manifest.version;

    if (!verification.ok) {
      // A failed checksum halts ingestion of that bundle (stop condition).
      extraErrors.push(
        `Checksum verification failed for ${bundle.manifest.source}@${bundle.manifest.version}: ${verification.issues
          .map((i) => i.path)
          .join(', ')}`,
      );
      continue;
    }

    for (const record of bundle.records) {
      const m = mapRecord(record, input.rules, aliases, input.ownerLookup);
      mapped.push(m);
      conflicts.push(...m.conflicts);
    }
  }

  const entities = projectEntities(mapped, input.authorityBySource);

  const publication = buildPublication({
    entities,
    conflicts,
    sourceVersions,
    publicationId: input.publicationId,
    publishedAt: input.publishedAt,
    actorId: input.actorId,
    approverIds: input.approverIds ?? [],
    extraErrors,
  });

  return { verifications, mapped, conflicts, entities, publication };
}
