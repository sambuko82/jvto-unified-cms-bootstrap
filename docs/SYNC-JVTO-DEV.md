# Sync: `jvto_cms → jvto_dev`

Push the **jvto_cms edit-master** (pages, org identity, media/asset registry) into the
**live jvto-web Postgres DB `jvto_dev`** — the DB behind `help.javavolcano-touroperator.com`.
This is the reverse of `deploy-prod` (which writes `jvto_cms`). The customer booking site
`javavolcano-touroperator.com` runs on a **different** DB and is unaffected.

- Engine: `scripts/sync-to-jvto-dev.mjs`
- Workflow: `.github/workflows/sync-jvto-dev.yml` (manual, mode-gated)
- Local double + proof: `db/jvto-dev/target-schema.sql`, `scripts/dev/seed-jvto-dev-local.mjs`, `tests/sync/sync.test.ts`

## What it does

| jvto_cms (source) | → | jvto_dev (target) | how |
|---|---|---|---|
| `pages` + `page_sections` (the `page_content` section holds jvto_dev's native content JSON) | → | **`content_pages`** (`route`+`lang`, `seo`, `content`) | upsert by `(route, lang)` |
| `assets` (SSOT image registry; console swaps `editable=true`) | → | **`assets`** + `cms.asset_map` | idempotent upsert via a stable `cms_key → asset_id` map |
| org-linked assets (`hero_image_url` / `logo_url`) + `governance_facts` | → | **`organization_profile`** | field-level update |
| full page + section + template model | → | **`cms.*`** (additive schema) | `cms.pages`, `cms.page_sections`, `cms.templates`, `cms.asset_map`, `cms.sync_log` |

**Full restructuring, live-safe.** The richer normalized model lands in an additive
CMS-owned `cms` schema — no existing jvto_dev table is altered or dropped, so `jvto-web`
keeps rendering `content_pages` unchanged. A future `jvto-web` can read `cms.*` directly.

## Guarantees

- **Replace** — rows the CMS manages are overwritten with CMS content (`ON CONFLICT DO UPDATE`).
- **Preserve** — rows the CMS does *not* manage are never touched or deleted (no truncation).
  jvto_dev-only pages/assets survive every run.
- **Idempotent** — re-running makes no further changes and creates no duplicates.
- **Relationships** — FK-ordered writes; assets attach through the existing folder/asset model.
- **Auditable** — every run writes `output/sync/jvto-dev-report.{json,md}` (inserted / updated /
  preserved per table) and `output/sync/rollback.sql` (pre-image restore of that run).

## Run it

1. **One-time:** add repo secret `JVTO_DEV_DATABASE_URL` (Settings → Secrets → Actions),
   URL-encoding `@` in the password as `%40`:
   `postgresql://postgres:PASS%40word@HOST:5432/jvto_dev`
   (`PROD_DATABASE_URL`, already set for `deploy-prod`, is the source.)
2. Actions tab → **sync-jvto-dev** → Run workflow → **mode = `plan`** (dry run, writes
   nothing) → review the report artifact + job summary.
3. Re-run with **mode = `apply`** to write `jvto_dev`. Verify on
   `https://help.javavolcano-touroperator.com/`.

**Rollback** the most recent run: download the `rollback.sql` artifact and
`psql "$JVTO_DEV_DATABASE_URL" -f rollback.sql`.

## Prove it locally

```
# one Postgres, two DBs
node scripts/dev/seed-jvto-dev-local.mjs           # JVTO_DEV_URL=…/jvto_dev_local
CMS_DATABASE_URL=…/jvto_cms_local JVTO_DEV_DATABASE_URL=…/jvto_dev_local \
  node scripts/sync-to-jvto-dev.mjs --plan         # dry run
TEST_DATABASE_URL=…/jvto_cms_local npm test        # tests/sync/sync.test.ts asserts the invariants
```
