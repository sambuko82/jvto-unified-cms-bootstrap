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
old 28-table governance schema is archived in `db/legacy/`.

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
psql jvto_cms -f output/seed/load.sql   # 172 entities · 52 pages · 203 sections · 7 redirects · 19 facts
```

Idempotent (upserts; sections regenerated each load). Verified locally on PostgreSQL 16.

## Refresh the data (3 commands)

```bash
npm run build:bundles && npm run consolidate   # re-extract atoms from the 3 data repos → projection.json
npm run pages                                  # rebuild the IA from config/pages.yaml → pages.json (fails on dangling refs)
npm run seed                                   # regenerate output/seed/*
DATABASE_URL=… npm run pull-db                 # (optional, "nanti") pull real page copy from jvto_dev, read-only
```

`npm run cms:build` runs consolidate → render → pages → seed in one shot.

## Live DB (`jvto_dev`) — read-only

Proven read-only via Adminer; the live route inventory + IA↔live reconciliation is in
`data/releases/jvto-db/content-pages-routes.json` (the 16 live tour routes match the
generated IA exactly). Full per-route `seo`/`content` sync is the deferred enrichment
via `scripts/pull-db.mjs` (connects with `DATABASE_URL`, facts-lock-sanitizes, **never
writes**). Credentials live only in a gitignored env — never in the repo.

## What the new workspace builds next (P3+)

The headless read/write API over this DB: `resolvePage(route)` (load page + sections +
hydrate refs + facts-lock scan + JSON-LD), `GET /pages`, `GET /pages/:route`,
`GET /entities/:type[/:key]`; then a minimal admin `PATCH` (editable page seo/section
copy only; `entities.editable=false` are read-only synced). Render UI = plug the
design-system components/tokens over the API.
