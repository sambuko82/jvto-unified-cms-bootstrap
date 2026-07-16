# PRD — JVTO Unified CMS Control Plane

## 1. Product summary

The JVTO Unified CMS is a PostgreSQL-backed internal control plane for managing content, product presentation, canonical knowledge, proof, policies, assets, people profiles, design contracts, source imports, approval, publication, and rollback.

It extends the existing `jvto-web` CMS and runtime. It does not replace the booking engine, PostgreSQL, or the source repositories.

## 2. Problem

JVTO information currently spans multiple repositories and PostgreSQL domains. Each source has legitimate responsibilities, but the system lacks one operational surface for:

- canonical entity mapping;
- field-level ownership;
- release imports;
- conflict detection;
- structured editorial editing;
- preview and approval;
- publishing and rollback;
- complete audit history.

Without governance, consolidation would create a new competing source of truth rather than solve drift.

## 3. Goals

- One CMS interface for relevant JVTO data.
- Explicit canonical owner for every public field.
- Versioned imports from connected repositories.
- Clear operational versus editorial separation.
- Structured pages and code-supported sections.
- Canonical proof ownership and controlled teaser surfaces.
- Controlled package and destination presentation.
- Policy consistency between machine rules and public documents.
- Public people profiles separated from internal crew records.
- Preview, approval, scheduling, publication, and rollback.
- Full auditability.

## 4. Non-goals

- Rebuild the public website.
- Replace the booking engine.
- Build a new standalone CMS framework.
- Move compiler logic out of `llm-wiki` or `jvto-itinerary-core`.
- Allow arbitrary page code or styling from the CMS.
- Make every imported source editable.
- Implement two-way Git synchronization in the MVP.

## 5. Users

| Role | Primary needs |
|---|---|
| Super Admin | System governance, users, emergency rollback |
| Publisher | Final approval and publication |
| Content Editor | Page, support, destination, and package copy |
| Product Editor | Package merchandising and package relations |
| Operations Editor | Price, itinerary, transport, hotel, route data |
| Trust Reviewer | Claims, credentials, proof, press, founder/police wording |
| Compliance Reviewer | Policies and legally sensitive statements |
| Media Manager | Assets, rights, placements, derivatives, verification |
| Design Maintainer | Component and visual-mode registry |
| Developer | Routes, schemas, templates, migrations, runtime contracts |
| Viewer | Read-only review and audit |

## 6. Product modules

1. Dashboard and System Health
2. Sources and Sync
3. Entity Registry
4. Website Pages and Sections
5. Products and Packages
6. Destinations and Routes
7. Operational Support Topics
8. Trust, Claims, Evidence and Proof
9. Policies
10. People and Reviews
11. Media and Documents
12. Design-System Registry
13. Publishing and Rollback
14. Governance, Permissions and Audit

## 7. MVP

The first usable release includes:

- source registry;
- release/import registry;
- entity registry;
- field ownership;
- conflict queue;
- page registry;
- page versions and structured sections;
- asset placements and proof ownership;
- trust-bundle and package-readiness import;
- preview;
- approval;
- publication manifest;
- route revalidation;
- rollback;
- audit log.

## 8. Success metrics

| Metric | Target |
|---|---:|
| Critical entities with canonical owner | 100% |
| Imported releases with manifest/checksum | 100% |
| Published claims with verified evidence | 100% |
| Public changes with actor and version | 100% |
| Unsupported CMS-created routes | 0 |
| Blocking conflicts allowed into publication | 0 |
| Private crew fields in public payloads | 0 |
| Package price mismatch at publication | 0 |
| Successful tested rollback | 100% |

## 9. Product decision

The CMS is a **modular monolith inside `jvto-web`**, backed by PostgreSQL and Prisma. This repository supplies the architecture, schema, contracts, validations, and execution plan for that implementation.
