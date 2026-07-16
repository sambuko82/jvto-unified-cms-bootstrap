# Target Integration into `jvto-web/live`

## Purpose

This repository is a build workspace. Production implementation should be integrated into `jvto-web/live` rather than deployed as an independent parallel CMS.

## Existing runtime areas to retain

- `src/app/(website)` public routes
- `src/app/(api)` API routes
- `src/app/(cms)` CMS shell
- `src/app/(customer)` customer routes
- `src/lib/packages`
- `src/lib/destinations`
- `src/lib/content`
- `src/lib/schemas`
- `src/lib/registry/pages.ts`
- Prisma and PostgreSQL
- current asset, package, destination, FAQ, policy, review, and booking tables

## Recommended new target modules

```text
src/modules/cms/
├── governance/
├── integrations/
├── entities/
├── pages/
├── products/
├── destinations/
├── routes/
├── support/
├── trust/
├── policies/
├── people/
├── reviews/
├── media/
├── design/
├── publishing/
└── audit/
```

## Recommended CMS routes

```text
/cms/dashboard
/cms/sources
/cms/sources/releases
/cms/sources/imports
/cms/conflicts
/cms/pages
/cms/products
/cms/destinations
/cms/routes
/cms/support
/cms/trust
/cms/policies
/cms/people
/cms/reviews
/cms/assets
/cms/design-system
/cms/publishing
/cms/governance
```

## Existing implementation priorities

1. Replace hardcoded CMS dashboard metrics.
2. Implement Content Pages rather than redirecting to `/cms`.
3. Replace the unimplemented FAQ API.
4. Split the large asset page into services, hooks, forms, and components.
5. Add source/entity/ownership governance before expanding page editing.
6. Preserve existing route and JSON-LD validators.
7. Add itinerary-intelligence sync using immutable releases and checksum validation.
8. Replace local absolute-path source synchronization with release artifacts.

## Migration safety

- Add new tables first.
- Add adapters over legacy tables.
- Migrate one module at a time.
- Do not drop legacy tables until all readers and writers are inventoried and redirected.
- Maintain rollback SQL and data snapshots for each migration.
