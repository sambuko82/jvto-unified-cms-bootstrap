# Changelog

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
