// Run the consolidation engine over the REAL committed release bundles
// (data/releases/*) and write the projected CMS to output/cms-projection/.
//
// This is the DB-free, live-free "map" step: it verifies every bundle's
// checksums, maps each record through field-ownership, projects canonical
// entities, gates the publication (private-field + conflict scan), and writes:
//   output/cms-projection/projection.json  — { entities, publication, counts }
//
// Deterministic (fixed publication id + timestamp) so the committed output is
// drift-guarded in CI. Reads config/{source-registry,field-ownership}.yaml as
// the authority. No network, no DB.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { runConsolidation } from '../dist/index.js';

const root = process.cwd();
const RELEASES = path.join(root, 'data/releases');
const OUT_DIR = path.join(root, 'output/cms-projection');
const GENERATED_AT = '2026-07-21T00:00:00.000Z';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000002';

const load = (rel) => yaml.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

function loadBundles() {
  const index = JSON.parse(fs.readFileSync(path.join(RELEASES, '_index.json'), 'utf8'));
  const bundles = [];
  for (const { source } of index.sources) {
    const dir = path.join(RELEASES, source);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    // Read the raw bytes so the sha256 in the manifest verifies exactly.
    const recordsRaw = fs.readFileSync(path.join(dir, 'records.json'), 'utf8');
    const records = JSON.parse(recordsRaw);
    bundles.push({ manifest, files: { 'records.json': recordsRaw }, records });
  }
  return bundles;
}

function main() {
  const registry = load('config/source-registry.yaml');
  const ownership = load('config/field-ownership.yaml');
  const authorityBySource = Object.fromEntries(registry.sources.map((s) => [s.code, s.authority_rank]));
  const rules = ownership.rules.map((r) => ({
    entityType: r.entity_type,
    fieldPath: r.field_path,
    ownerSource: r.owner_source,
    writePolicy: r.write_policy,
    conflictPolicy: r.conflict_policy,
  }));

  const bundles = loadBundles();
  const result = runConsolidation({
    bundles,
    rules,
    authorityBySource,
    actorId: 'consolidation-engine',
    approverIds: ['jvto-governance'],
    publicationId: PUBLICATION_ID,
    publishedAt: GENERATED_AT,
  });

  const badChecksums = result.verifications.filter((v) => !v.ok);
  if (badChecksums.length) {
    console.error('Checksum verification FAILED for:', badChecksums.map((v) => v.source).join(', '));
    process.exit(1);
  }

  const byType = {};
  for (const e of result.entities) byType[e.entityType] = (byType[e.entityType] || 0) + 1;

  const projection = {
    generatedAt: GENERATED_AT,
    releaseVersion: JSON.parse(fs.readFileSync(path.join(RELEASES, '_index.json'), 'utf8')).releaseVersion,
    counts: {
      records: bundles.reduce((n, b) => n + b.records.length, 0),
      entities: result.entities.length,
      byType,
      blockingConflicts: result.conflicts.filter((c) => c.severity === 'blocking').length,
      warnings: result.publication.validation.warnings.length,
    },
    publication: result.publication,
    entities: result.entities,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'projection.json'), JSON.stringify(projection, null, 2) + '\n');

  console.log(
    `Consolidation: ${projection.counts.records} records -> ${projection.counts.entities} entities, ` +
      `passed=${result.publication.validation.passed}, blocking=${projection.counts.blockingConflicts}, ` +
      `warnings=${projection.counts.warnings}`,
  );
  console.log('By type:', JSON.stringify(byType));
  if (!result.publication.validation.passed) {
    console.error('Publication gate did NOT pass:', result.publication.validation.errors.join('; '));
    process.exit(1);
  }
}

main();
