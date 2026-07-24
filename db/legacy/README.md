# db/legacy — superseded governance schema (kept for history, NOT applied)

These are the original multi-source **control-plane** migrations + view:

- `migrations/0001_cms_control_plane.sql` — 15 tables (integration/staging, canonical
  entity + version + ownership, page/section, publication, audit).
- `migrations/0002_cms_domain_entities.sql` — 13 typed projection + cross-repo identity tables.
- `views/cms_publication_ready_pages.sql` — publication-readiness read model.

They implemented multi-source arbitration (staging → ownership → conflict → precedence →
8-state workflow → publication manifests). The committed consolidation run resolves to
**0 conflicts / 0 warnings**, so with a single authoritative consolidated source that whole
layer is unnecessary. It is **superseded by `db/core/schema.sql`** (6 tables: entities,
pages, page_sections, redirects, governance_facts, assets).

Kept only for reference/history — do not apply. The CMS core uses `db/core/schema.sql`.
