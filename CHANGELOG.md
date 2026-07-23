# Changelog

## Unreleased — Static CMS Projection (DB-free, live-free)

- Real release bundles: `scripts/build-release-bundles.mjs` extracts every source
  repo's compiled output (llm-wiki trust/policy bundles, okf release, itinerary-core
  generated, design-system seed) into committed, checksummed immutable releases
  under `data/releases/*` — 182 records across 6 sources.
- Consolidation runner + static renderer: `scripts/consolidate.mjs` runs the
  existing engine over the real estate → `output/cms-projection/projection.json`
  (176 entities, gate passed, 0 blocking conflicts); `scripts/render-cms.mjs`
  emits a self-contained, browsable `output/cms-projection/index.html` grouped by
  visual-mode cluster → entity type, each field badged with its owning source +
  field-ownership write policy. No DB, no server, no JS runtime (ADR-007).
- Cross-check guard: `scripts/crosscheck-bundles.mjs` verifies the built bundles
  match jvto-web's synced `src/data/*`; caught + corrected retired conditional
  Ijen-health wording (facts-lock: mandatory).
- Taxonomy coverage: added `activity` field-ownership + consolidation mapping;
  aligned `claim.canonical_wording` to `read_only` (synced, mirrors jvto-web).
- CI: `verify:projection` re-consolidates + re-renders over committed bundles and
  drift-guards `output/`; new `tests/integration/real-bundles.test.ts` (6 cases).
- Docs: `docs/10_STATIC_PROJECTION.md`, ADR-007.

## Unreleased — Phase 2: Source Integration Center (consolidation engine)

- Consolidation ingestion engine (`src/integration/*`): checksum verification,
  canonical-key resolution (multi-form JVTO slugs), field diff, ownership mapping
  (reuses `decideIncomingFieldChange`), entity projection, and publication
  manifest assembly (reuses `evaluatePublication`) — pure, deterministic,
  exported from `src/index.ts`.
- Registry expanded to the full estate: added `llm-wiki-policy`,
  `knowledge-catalog-okf`, and `canonical-facts` sources; full `field-ownership`
  rule set (policy incl. v2 cancellation + Xendit payment, packages, routes,
  destinations, people, reviews, trust, faqs, pages) with `canonical-facts` as
  the adjudication tie-breaker.
- New `config/consolidation-map.yaml` + schema; `validate:config` now
  cross-checks map coherence (sources, entity types, field ownership).
- Real consolidated release fixtures for all six sources
  (`examples/consolidation/*`) + a golden publication manifest; `build:fixtures`.
- Additive `db/migrations/0002_cms_domain_entities.sql` (typed projection + join
  tables aligned to jvto-web Prisma; idempotent, with rollback notes).
- `docs/09_CONSOLIDATION_MAP.md`; expanded vitest suite (26 tests incl. the
  golden end-to-end pipeline and an adversarial ownership-block case).

## 0.1.0

- Initial Codex-ready bootstrap.
- PRD, architecture, source ownership, data model, orchestration, phase plan, and acceptance criteria.
- PostgreSQL control-plane migration draft.
- Typed contracts, precedence service, publication gates, examples, tests, and validation workflow.
