# JVTO Unified CMS Control Plane

A Codex-ready implementation workspace for consolidating JVTO content, knowledge, product data, trust evidence, design contracts, and itinerary intelligence into one PostgreSQL-backed CMS control plane.

## Important architectural rule

This repository is **not the public production website and not a parallel third-party CMS framework**. It DOES host the governed in-repo editorial console — a write API + admin UI over the fresh `jvto_cms` database — authorized by **ADR-008**. That console is the single content edit master; public rendering and booking stay in `jvto-web`.

It is the implementation workspace and governance contract for extending the existing:

- `jvto-devteam/jvto-web` production application;
- JVTO PostgreSQL database;
- existing custom CMS under `src/app/(cms)`;
- Prisma data layer;
- repository sync and validation pipelines.

Public rendering and booking remain in `jvto-web/live`; the editorial console over `jvto_cms` is the "later architecture decision" reserved here (see **ADR-008**), and it never serves the public site.

## Connected source systems

| System | Responsibility |
|---|---|
| `jvto-web` | Production runtime, CMS, APIs, bookings, publishing |
| `llm-wiki` | Canonical knowledge, claims, evidence, policies, compiled content bundles |
| `jvto-itinerary-core` | Route feasibility, operational itinerary intelligence, scenario outputs |
| `jvto-new-on-design-system` | Visual tokens, component contracts, prototypes, migration references |
| JVTO PostgreSQL | Operational truth, CMS state, versions, audit history |

## Product principles

1. **Improve in place.** Do not rebuild the public website from zero.
2. **Preserve ownership.** The CMS unifies access and publication without erasing canonical sources.
3. **Registry first.** Build entity, source, ownership, version, and placement registries before a broad page builder.
4. **Package first.** Package pages remain product-first, practicalities-next, trust-later.
5. **Proof is canonical.** Heavy proof has one owner page and controlled teaser placements.
6. **Open source first.** Use the existing Next.js, TypeScript, Prisma, and PostgreSQL stack.
7. **No arbitrary layouts.** Editors select code-supported section and component contracts.
8. **Every change is traceable.** Imports, edits, approvals, publications, and rollbacks are audited.

## Repository map

```text
.
├── AGENTS.md                         Codex operating contract
├── docs/                             Product and architecture documentation
├── config/                           Governed registries and board rules
├── db/                               PostgreSQL target schema and read views
├── schemas/                          JSON Schema contracts for integrations
├── src/                              Typed reference implementation
├── scripts/                          Validation and safety scripts
├── tests/                            Unit tests for precedence and publication gates
├── examples/                         Example source releases and publication manifests
├── integration/jvto-web/             Target integration map for the live repository
└── .github/workflows/validate.yml    Repository validation workflow
```

## First commands

```bash
npm install
npm run validate
npm test
```

## Recommended execution sequence

1. Complete Phase 0 security and production baseline.
2. Implement source, entity, ownership, conflict, and audit tables.
3. Build versioned source import and staging.
4. Upgrade the existing `jvto-web` CMS page/content/asset modules.
5. Connect packages, destinations, routes, trust, policy, people, and reviews.
6. Add preview, approvals, publication manifests, revalidation, and rollback.

Read these first:

1. `AGENTS.md`
2. `docs/00_PRD.md`
3. `docs/01_ARCHITECTURE.md`
4. `docs/02_SOURCE_OWNERSHIP.md`
5. `docs/05_PHASE_PLAN.md`
6. `integration/jvto-web/TARGET_INTEGRATION.md`
