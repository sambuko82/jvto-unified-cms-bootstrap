# Architecture

## 1. System context

```text
Canonical Spec Set
        │
        ├── governs page roles, visual modes, content hierarchy and rollout
        │
llm-wiki ───────────────┐
jvto-itinerary-core ────┼── versioned validated releases ──┐
design-system repo ─────┘                                  │
                                                           ▼
                                              JVTO Unified CMS
                                         inside jvto-web / PostgreSQL
                                                           │
                              ┌────────────────────────────┼────────────────────────────┐
                              ▼                            ▼                            ▼
                       Public Website                 Internal CMS                 APIs/Agents
```

## 2. Runtime boundary

`jvto-web` remains the deployable runtime. The new CMS modules should live inside the existing application and use the existing authentication, Prisma client, APIs, route registry, JSON-LD builders, FAQ resolver, package queries, and destination queries.

## 3. Logical PostgreSQL domains

```text
existing operational tables
    packages, prices, itineraries, destinations, routes, bookings, crew, hotels...

cms_*
    pages, versions, sections, profiles, placements, workflow

kb_*
    claims, evidence, proof groups, knowledge projections

integration_*
    sources, releases, import runs, staged records, mappings, conflicts

audit_*
    actions, changes, publications, rollback records
```

## 4. Producer-consumer contracts

### llm-wiki

Produces canonical knowledge and compiled bundles. The CMS consumes versioned outputs and does not edit the compiler-owned source payload directly.

### jvto-itinerary-core

Produces derived route feasibility and itinerary intelligence. The CMS displays and binds outputs but does not duplicate the scenario engine.

### Design system

Produces tokens and component contracts. The CMS allows a component only after the component exists in the runtime.

### PostgreSQL operational tables

Own transactional and operational truth. Editorial modules may reference but must not silently override operational fields.

## 5. Read/write architecture

```text
External release
    ↓ validate and stage
integration_source_records
    ↓ map and resolve ownership
cms_entities + typed operational records
    ↓ create approved projection
cms_*_versions / kb_* / approved read models
    ↓ publish
public Next.js renderers
```

## 6. No raw import rendering

Public pages must never render directly from:

- raw Git repository files;
- integration staging JSON;
- unapproved draft versions;
- unresolved conflict payloads;
- design prototypes;
- private operational records.

## 7. Page architecture

The CMS stores page configuration, versions, and sections. Code remains responsible for:

- route implementation;
- section component implementation;
- server-side authorization;
- public rendering;
- JSON-LD builders;
- route and canonical validation;
- cache revalidation.

## 8. Publication architecture

Publication is a transaction that:

1. validates ownership and workflow;
2. validates page/template/section contracts;
3. validates package and trust dependencies;
4. creates a publication manifest;
5. updates current-version pointers;
6. revalidates affected cache tags and routes;
7. performs post-publication checks;
8. records rollback data.
