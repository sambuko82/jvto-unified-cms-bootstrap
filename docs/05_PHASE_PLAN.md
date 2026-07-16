# Implementation Phases

## Phase 0 — Security and Baseline

- Rotate exposed credentials and tokens.
- Remove secrets from Git and purge history.
- Back up PostgreSQL.
- Record production branch, commit, schema, and deployment procedure.
- Inventory CMS routes, APIs, consumers, and placeholders.

**Exit:** secure baseline and recoverable backup.

## Phase 1 — Governance Foundation

- Source registry.
- Entity registry.
- Alias and relation registry.
- Field ownership rules.
- Roles and permissions.
- Audit events.
- Conflict types and workflow.

**Exit:** critical entities and fields have canonical ownership.

## Phase 2 — Source Integration Center

- Trust bundle importer.
- Package-readiness importer.
- Blog importer.
- Itinerary-core release importer.
- Design-system manifest importer.
- Checksum, manifest, staging, diff, conflict, and promotion UI.

**Exit:** imports are version-pinned, traceable, and rollback-safe.

## Phase 3 — Page, Content and Asset Core

- Page registry UI.
- Page versions.
- Structured section editor.
- Section and template contracts.
- Visual-mode selection.
- Asset roles and placements.
- Canonical owner versus teaser surface.
- Preview.

**Exit:** one full page cluster can be edited, reviewed, published, and rolled back.

## Phase 4 — Products, Destinations and Routes

- Operational versus editorial separation.
- Package presentation versions.
- Package readiness comparison.
- Itinerary intelligence snapshots.
- Destination presentation versions.
- Route profiles and support topics.

**Exit:** package and destination pages render from governed read models.

## Phase 5 — Trust, Policy, People and Reviews

- Claims and evidence.
- Proof ownership and placement.
- Policy rules and documents.
- Public people profile separation.
- Review features and themes.

**Exit:** claims, policies, people, and reviews meet governance requirements.

## Phase 6 — Publishing and Rollback

- Review queue.
- Approval matrix.
- Scheduled publication.
- Publication manifests.
- Cache/path revalidation.
- Post-publish verification.
- Rollback.

**Exit:** no unversioned production edits.

## Phase 7 — Advanced Intelligence

- Semantic approved-content search.
- AI-safe read API.
- Staleness and gap detection.
- Cross-channel projections.
- Repository feedback requests.

**Exit:** automation reads only approved governed models.
