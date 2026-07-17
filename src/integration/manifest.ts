import type { SourceReleaseManifest } from '../contracts/sourceRelease.js';
import { sha256Hex } from './canonical.js';
import type { ManifestVerification, ReleaseFileBytes } from './types.js';

/**
 * Verify that every file declared in a release manifest is present in the
 * supplied bytes map and that its sha256 matches. This is the checksum gate
 * from docs/04_ORCHESTRATION.md step "verify checksum" — implemented with real
 * crypto rather than the structural-only regex the JSON Schema performs.
 */
export function verifyManifestChecksums(
  manifest: SourceReleaseManifest,
  files: ReleaseFileBytes,
): ManifestVerification {
  const issues: ManifestVerification['issues'] = [];
  for (const file of manifest.files) {
    const bytes = files[file.path];
    if (bytes === undefined) {
      issues.push({ path: file.path, expected: file.sha256, actual: 'MISSING' });
      continue;
    }
    const actual = sha256Hex(bytes);
    if (actual.toLowerCase() !== file.sha256.toLowerCase()) {
      issues.push({ path: file.path, expected: file.sha256, actual });
    }
  }
  return { ok: issues.length === 0, issues };
}
