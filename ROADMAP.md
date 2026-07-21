# Roadmap

## Now

- Security remediation.
- Production baseline.
- Ownership and entity registry implementation.
- Phase 2 consolidation engine (DELIVERED in-repo): checksum → canonical-key →
  ownership map → conflict → project → publication, over real release fixtures
  for all six sources. See `docs/09_CONSOLIDATION_MAP.md` + `src/integration/*`.
- Static CMS projection (DELIVERED in-repo): the engine now runs over the REAL
  committed estate (`data/releases/*`, 182 records → 176 entities) and renders a
  DB-free / live-free browsable catalog at `output/cms-projection/index.html`.
  Read-only build artifact per ADR-007. See `docs/10_STATIC_PROJECTION.md`.

## Next

- Versioned source import center — wire the live GitHub-release **download** side
  (the one boundary left out of the pure engine) in the jvto-web importer runtime.
- Page/content/asset core.
- Package and destination integration.

## Later

- Trust and policy completion.
- Full publication workflow.
- AI-safe approved-content APIs.
