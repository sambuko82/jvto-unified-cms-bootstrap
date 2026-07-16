# Architecture Decisions

## ADR-001 — Extend existing CMS

**Decision:** Extend `jvto-web` custom CMS rather than add Payload, Directus, or Strapi in parallel.

**Reason:** Existing runtime already has CMS routes, Prisma, PostgreSQL, auth, packages, destinations, assets, policies, FAQs, and operational relations.

## ADR-002 — Modular monolith

**Decision:** Keep one deployable Next.js application with internal modules.

**Reason:** Lower operational complexity and direct access to existing services and route validation.

## ADR-003 — Registry-first

**Decision:** Build sources, entities, ownership, conflicts, versions, and placements before a broad visual page builder.

## ADR-004 — Immutable source releases

**Decision:** Consume versioned releases with manifests and checksums, not mutable repository branches or local absolute paths.

## ADR-005 — Operational/editorial separation

**Decision:** Preserve operational tables and add editorial version tables rather than overload operational models further.

## ADR-006 — No arbitrary CMS code

**Decision:** Section and component contracts are implemented in code and selected through the CMS.
