import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { createRequire } from 'node:module';
import { runConsolidation } from '../../src/integration/pipeline.js';
import { mapRecord } from '../../src/integration/mapper.js';
import { projectEntities, buildPublication } from '../../src/integration/project.js';
import type { FieldOwnershipRule } from '../../src/domain/types.js';
import type { ImportRecord, ReleaseBundle } from '../../src/integration/types.js';
import type { SourceReleaseManifest } from '../../src/contracts/sourceRelease.js';

const root = process.cwd();
const fixturesDir = path.join(root, 'examples/consolidation');
const PUBLISHED_AT = '2026-07-16T00:00:00.000Z';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000001';

function loadYaml(rel: string): Record<string, unknown> {
  return yaml.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
}

function loadRules(): FieldOwnershipRule[] {
  const doc = loadYaml('config/field-ownership.yaml') as { rules: Array<Record<string, string>> };
  return doc.rules.map((r) => ({
    entityType: r.entity_type as string,
    fieldPath: r.field_path as string,
    ownerSource: r.owner_source as string,
    writePolicy: r.write_policy as FieldOwnershipRule['writePolicy'],
    conflictPolicy: r.conflict_policy as FieldOwnershipRule['conflictPolicy'],
  }));
}

function loadAuthority(): Record<string, number> {
  const doc = loadYaml('config/source-registry.yaml') as {
    sources: Array<{ code: string; authority_rank: number }>;
  };
  return Object.fromEntries(doc.sources.map((s) => [s.code, s.authority_rank]));
}

function loadBundles(): ReleaseBundle[] {
  const bundles: ReleaseBundle[] = [];
  for (const entry of fs.readdirSync(fixturesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(fixturesDir, entry.name);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as SourceReleaseManifest;
    const recordsRaw = fs.readFileSync(path.join(dir, 'records.json'), 'utf8');
    const records = JSON.parse(recordsRaw) as ImportRecord[];
    bundles.push({ manifest, files: { 'records.json': recordsRaw }, records });
  }
  return bundles;
}

// Load Ajv/ajv-formats via CJS require so the CJS default export is
// constructable/callable under NodeNext without interop-typing gymnastics.
const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const Ajv2020 = require('ajv/dist/2020.js') as new (opts?: unknown) => any;
const addFormats = require('ajv-formats') as (ajv: any) => void;
const ajv: any = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const importSchema = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(root, 'schemas/import-record.schema.json'), 'utf8')),
);
const releaseSchema = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(root, 'schemas/source-release.schema.json'), 'utf8')),
);
const publicationSchema = ajv.compile(
  JSON.parse(fs.readFileSync(path.join(root, 'schemas/publication-manifest.schema.json'), 'utf8')),
);

describe('consolidation fixtures conform to the wire contracts', () => {
  const bundles = loadBundles();
  it('has fixtures for every consolidation source', () => {
    expect(bundles.length).toBeGreaterThanOrEqual(6);
  });
  it('every manifest validates against source-release.schema.json', () => {
    for (const b of bundles) {
      expect(releaseSchema(b.manifest), JSON.stringify(releaseSchema.errors)).toBe(true);
    }
  });
  it('every import record validates against import-record.schema.json', () => {
    for (const b of bundles) {
      for (const r of b.records) {
        expect(importSchema(r), JSON.stringify(importSchema.errors)).toBe(true);
      }
    }
  });
});

describe('full consolidation pipeline (golden)', () => {
  const result = runConsolidation({
    bundles: loadBundles(),
    rules: loadRules(),
    authorityBySource: loadAuthority(),
    actorId: 'fixture-actor',
    approverIds: ['fixture-approver'],
    publicationId: PUBLICATION_ID,
    publishedAt: PUBLISHED_AT,
  });

  it('verifies every bundle checksum', () => {
    expect(result.verifications.every((v) => v.ok)).toBe(true);
  });

  it('merges multi-source records into single canonical entities', () => {
    const pkg = result.entities.find((e) => e.canonicalKey === 'package:bromo-ijen-3d2n');
    expect(pkg).toBeDefined();
    // route_sequence (itinerary-core) + profile (okf) both landed on one entity
    expect(Object.keys(pkg?.fields ?? {})).toEqual(
      expect.arrayContaining(['route_sequence', 'profile', 'module_refs']),
    );
  });

  it('carries the v2 policy + Xendit payment as a policy_document entity', () => {
    const policy = result.entities.find((e) => e.canonicalKey === 'policy_document:cancellation-package-credit');
    expect(policy).toBeDefined();
    const payment = policy?.fields['payment_methods']?.value as Record<string, unknown> | undefined;
    expect(payment?.['gateway']).toBe('Xendit');
    expect(policy?.fields['decision_matrix']).toBeDefined();
    // the adjudicated facts (canonical-facts) co-exist on the same entity
    expect(policy?.fields['adjudicated_facts']?.source).toBe('canonical-facts');
  });

  it('produces a schema-valid, publishable publication manifest', () => {
    expect(result.publication.validation.passed).toBe(true);
    expect(publicationSchema(result.publication), JSON.stringify(publicationSchema.errors)).toBe(true);
  });

  it('matches the committed golden publication manifest', () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(fixturesDir, 'expected-publication.json'), 'utf8'),
    );
    expect(result.publication).toEqual(golden);
  });
});

describe('adversarial: a lower-authority source cannot overwrite an owned field', () => {
  it('blocks the record, excludes the entity, and fails the gate', () => {
    const rogue: ImportRecord = {
      source: 'design-system',
      releaseVersion: '1',
      externalKey: 'bali/bromo-ijen-3d2n',
      entityType: 'package',
      canonicalKey: 'package:bromo-ijen-3d2n',
      payload: { price_tiers: [{ pax: 2, idr: 1 }] },
      payloadSha256: '0'.repeat(64),
    };
    const rules = loadRules();
    const mapped = mapRecord(rogue, rules, {}, () => ({
      ownerSource: 'postgres-operational',
      value: [{ pax: 2, idr: 1550000 }],
    }));
    expect(mapped.clean).toBe(false);
    const entities = projectEntities([mapped], loadAuthority());
    expect(entities).toHaveLength(0);
    const publication = buildPublication({
      entities,
      conflicts: mapped.conflicts,
      sourceVersions: { 'design-system': '1' },
      publicationId: PUBLICATION_ID,
      publishedAt: PUBLISHED_AT,
      actorId: 'a',
      approverIds: ['b'],
    });
    expect(publication.validation.passed).toBe(false);
    expect(publication.validation.errors.join(' ')).toContain('blocking conflicts');
  });
});
