# CMS Core — the drop-in base

A clean, self-contained content core: **2 stores + 1 resolver**, seeded from the
consolidated repo estate + the design-system IA. No jvto-web dependency. Drop the
schema + seed pack into a fresh Postgres and you have a populated CMS.

## Concept

```
content atoms (entities)   ×   page composition (pages/sections)   →   resolved site
        │                                  │
  llm-wiki + itinerary-core +        jvto-new-on-design-system IA
  knowledge-catalog-okf (+ jvto_db)  (config/pages.yaml)
```

A single authoritative content source (the consolidated projection, 0 conflicts)
means **no ownership / conflict / staging / workflow / publication machinery** — the
old 28-table governance schema has been removed.

## Schema (`db/core/schema.sql`, 6 tables)

| Table | Holds |
|---|---|
| `entities` | content atoms — `{entity_type, canonical_key, data jsonb, provenance jsonb, editable}` |
| `pages` | routes/ordering/grouping — `{route, file_group(001–008), sort_order, cluster, page_type, template, visual_mode, hub_route, seo}` |
| `page_sections` | ordered blocks — `{section_type, variant, content, entity_refs[]}` (refs = `entities.canonical_key`) |
| `redirects` | legacy → canonical |
| `governance_facts` | the facts lock (self-contained; from `governance/canonical-facts.json`) |
| `assets` | media registry |

`page_render` view = page + ordered sections; the resolver hydrates `entity_refs`.

## Load it (fresh Postgres)

```bash
createdb jvto_cms
psql jvto_cms -f db/core/schema.sql
psql jvto_cms -f output/seed/load.sql   # 172 entities · 58 pages · 266 sections · 7 redirects · 19 facts
```

Idempotent (upserts; sections regenerated each load). Verified locally on PostgreSQL 16.

## Refresh the data (3 commands)

```bash
npm run build:bundles && npm run consolidate   # re-extract atoms from the 3 data repos → projection.json
npm run build:design-extract                   # compose page copy from jvto-new-on-design-system → data/releases/design-system/content-pages.json
npm run pages                                  # rebuild the IA from config/pages.yaml + overlay the extract → pages.json (fails on dangling refs)
npm run seed                                   # regenerate output/seed/*
```

`npm run cms:build` runs consolidate → render → build:design-extract → pages → seed in one shot.

## Page copy source — `jvto-new-on-design-system` (no jvto_dev)

Per-route page copy (`seo` + `page_content` body/FAQ) is composed from the design-system
repo by `scripts/build-design-system-extract.mjs` (override the source with
`DESIGN_SYSTEM_PATH`): markdown page files keyed on frontmatter `page:`, tour bodies from
`products.json` (canonical IDR pricing), verify pages from `legal-licenses/police-integration/press-coverage.md`
+ the verify `*.html`, SEO description derived from each page's lede. Deterministic —
re-runs are byte-identical (`verify:projection` guards `output/` **and**
`data/releases/design-system/`). The prior `jvto_dev` extract + `scripts/pull-db.mjs` are
retired (pull-db.mjs kept on disk, unreferenced). No live DB in the copy pipeline.

## What the new workspace builds next (P3+)

The headless read/write API over this DB: `resolvePage(route)` (load page + sections +
hydrate refs + facts-lock scan + JSON-LD), `GET /pages`, `GET /pages/:route`,
`GET /entities/:type[/:key]`; then a minimal admin `PATCH` (editable page seo/section
copy only; `entities.editable=false` are read-only synced). Render UI = plug the
design-system components/tokens over the API.
