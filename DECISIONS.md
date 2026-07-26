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

## ADR-007 — Static read-only projection is a build artifact, not a runtime

**Decision:** The consolidation engine may emit a committed, self-contained static
projection of the CMS — `output/cms-projection/projection.json` (data) and
`output/cms-projection/index.html` (a browsable catalog) — generated offline from
the committed release bundles (`data/releases/*`) by `scripts/{consolidate,render-cms}.mjs`.

**This is NOT a second CMS runtime** (see `AGENTS.md`, ADR-001, `README.md`). The
projection has no server, no database, no authentication, no editing, and no JS
runtime — it is a read-only preview artifact (like a coverage or audit report),
produced by pure functions and drift-guarded in CI. It never becomes a source of
truth: every value carries its owning source and field-ownership write policy, and
`canonical-facts` remains the tie-breaker. Production editing and public rendering
stay in `jvto-web` per ADR-001. This written decision satisfies the `AGENTS.md`
constraint that a runtime/UI requires an explicit architecture decision — it
authorizes only the static artifact, not a runtime.

**Reason:** The owner needs to *see and verify* the consolidated CMS without a DB or
live site. A deterministic static projection makes the consolidation concrete and
reviewable while respecting the "one runtime, in jvto-web" boundary.

## ADR-008 — In-repo editable control-plane CMS over `jvto_cms`

**Decision:** This repository runs a governed editorial console — a Fastify write API
(`src/server.ts`: `PATCH /pages/<route>`, `PUT /pages/<route>/sections/<type>`) plus a
server-rendered admin UI — over the fresh `jvto_cms` PostgreSQL database, which is the
single editable content master. Console edits set `editable=true`; they are published by
exporting the seed *from* `jvto_cms` (`scripts/export-cms-seed.mjs`), and `jvto-web`
renders that seed. This is the "later architecture decision" that ADR-007 and `README.md`
reserved.

**This IS a governed editorial console, NOT a public site or a parallel CMS framework.**
It lifts ADR-007's "no server / no database / no authentication / no editing / not a
runtime" limit for THIS control plane only. Every other boundary holds: imported
repository data stays read-only (`entities.editable = false`); no arbitrary JSX/CSS/code
in content; no private crew/customer/payment/auth fields in any payload; every write is
authenticated (admin token/session), facts-locked against `governance_facts` (rejected on
violation, not merely warned), and audited (`audit_log`). It uses the fresh `jvto_cms`
only — never `jvto_dev`. Public rendering and booking remain in `jvto-web` per ADR-001;
this console never serves the public website.

**Reason:** The owner needs one authoritative place to edit canonical content.
Co-locating the write API + console with the schema and facts-lock engine over `jvto_cms`
makes it the edit master, while the deterministic export→seed bridge keeps `jvto-web` a
pure downstream renderer.
