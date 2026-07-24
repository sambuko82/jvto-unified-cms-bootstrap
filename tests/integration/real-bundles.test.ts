import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { runConsolidation } from '../../src/integration/pipeline.js';
import type { FieldOwnershipRule } from '../../src/domain/types.js';
import type { ImportRecord, ReleaseBundle } from '../../src/integration/types.js';
import type { SourceReleaseManifest } from '../../src/contracts/sourceRelease.js';

// Consolidate the REAL committed release bundles (data/releases/*) and assert the
// projection is complete, gate-passing, and facts-locked. This verifies the
// standalone (DB-free, live-free) CMS end to end from the committed data — the
// same run scripts/consolidate.mjs performs, but as a CI-native test.
const root = process.cwd();
const RELEASES = path.join(root, 'data/releases');
const PUBLISHED_AT = '2026-07-21T00:00:00.000Z';
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000002';

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
  const index = JSON.parse(fs.readFileSync(path.join(RELEASES, '_index.json'), 'utf8')) as {
    sources: Array<{ source: string }>;
  };
  return index.sources.map(({ source }) => {
    const dir = path.join(RELEASES, source);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as SourceReleaseManifest;
    const recordsRaw = fs.readFileSync(path.join(dir, 'records.json'), 'utf8');
    const records = JSON.parse(recordsRaw) as ImportRecord[];
    return { manifest, files: { 'records.json': recordsRaw }, records };
  });
}

describe('real consolidated estate', () => {
  const result = runConsolidation({
    bundles: loadBundles(),
    rules: loadRules(),
    authorityBySource: loadAuthority(),
    actorId: 'test',
    approverIds: ['test'],
    publicationId: PUBLICATION_ID,
    publishedAt: PUBLISHED_AT,
  });

  it('verifies every bundle checksum', () => {
    expect(result.verifications.every((v) => v.ok)).toBe(true);
  });

  it('passes the publication gate with no blocking conflicts', () => {
    expect(result.publication.validation.passed).toBe(true);
    expect(result.conflicts.filter((c) => c.severity === 'blocking')).toHaveLength(0);
  });

  it('projects every core entity type from the real estate', () => {
    const byType: Record<string, number> = {};
    for (const e of result.entities) byType[e.entityType] = (byType[e.entityType] ?? 0) + 1;
    // Package: 16 (Bali + Surabaya variants keyed distinctly), claims C1-C9, etc.
    expect(byType.claim).toBe(9);
    expect(byType.faq).toBe(9);
    expect(byType.public_person_profile).toBe(16);
    expect(byType.package).toBe(16);
    expect(byType.general_module).toBe(67);
    expect(byType.policy_document).toBe(9);
    expect(byType.route).toBe(18);
    expect(byType.activity).toBe(18);
    expect(byType.page).toBe(4);
    expect(result.entities.length).toBeGreaterThanOrEqual(170);
  });

  it('carries the owned canonical claim wording (synced, read-only)', () => {
    const c1 = result.entities.find((e) => e.canonicalKey === 'claim:c1');
    expect(c1?.fields.canonical_wording?.source).toBe('llm-wiki-trust');
    expect(typeof c1?.fields.canonical_wording?.value).toBe('string');
  });

  it('enforces the facts-lock: Ijen screening is mandatory, never conditional', () => {
    const raw = JSON.stringify(result.entities);
    expect(raw).not.toContain('when BBKSDA regulations require it');
    // Upstream (okf #31) now states this directly, so the projection carries
    // mandatory-per-guest wording regardless of the extractor's facts-lock sanitizer.
    expect(raw).toContain('mandatory for every guest');
  });

  it('leaks no private fields into the projection', () => {
    expect(result.publication.validation.errors).toHaveLength(0);
  });
});
