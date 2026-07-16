// Public entry point for the JVTO Unified CMS control-plane engine.
// Pure, deterministic building blocks that a runtime (jvto-web) composes into
// the full download → stage → map → conflict → project → publish import flow.

export * from './domain/enums.js';
export * from './domain/types.js';
export * from './contracts/sourceRelease.js';
export * from './contracts/publication.js';

export { decideIncomingFieldChange } from './services/source-precedence.js';
export { evaluatePublication } from './services/publication-gates.js';
export type { PublicationGateResult } from './services/publication-gates.js';

export {
  canonicalJson,
  sha256Hex,
  payloadHash,
  normalizeSlug,
  resolveCanonicalKey,
} from './integration/canonical.js';
export { verifyManifestChecksums } from './integration/manifest.js';
export { findOwnershipRule } from './integration/ownership.js';
export { mapRecord } from './integration/mapper.js';
export { projectEntities, buildPublication, deterministicUuid } from './integration/project.js';
export { runConsolidation } from './integration/pipeline.js';
export type * from './integration/types.js';
