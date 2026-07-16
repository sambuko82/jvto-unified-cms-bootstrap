import { describe, expect, it } from 'vitest';
import { verifyManifestChecksums } from '../../src/integration/manifest.js';
import { sha256Hex } from '../../src/integration/canonical.js';
import type { SourceReleaseManifest } from '../../src/contracts/sourceRelease.js';

const bytes = '{"hello":"world"}\n';
const manifest: SourceReleaseManifest = {
  source: 'demo',
  version: '1',
  producedAt: '2026-07-16T00:00:00.000Z',
  schemaVersion: 1,
  files: [{ path: 'records.json', sha256: sha256Hex(bytes) }],
};

describe('manifest checksum verification', () => {
  it('passes when bytes match the declared sha256', () => {
    const result = verifyManifestChecksums(manifest, { 'records.json': bytes });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects a tampered file', () => {
    const result = verifyManifestChecksums(manifest, { 'records.json': bytes + 'tampered' });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.path).toBe('records.json');
  });

  it('detects a missing file', () => {
    const result = verifyManifestChecksums(manifest, {});
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.actual).toBe('MISSING');
  });
});
