# CLAUDE.md — mission memory (read first, every session)

Persistent direction so work stays on track and does not go in circles. Operating contract:
`AGENTS.md`; architecture decisions: `DECISIONS.md`. This file is the north star + the data map.

## Mission (north star)
`jvto-cms.javavolcano-touroperator.com` (DB **`jvto_cms`**) is the **editable master** that must
**mirror the live public content** shown on `help.javavolcano-touroperator.com`. The CMS content is
**sourced from the STRUCTURED upstream repos**, NOT scraped from live HTML (scraping is lossy — last resort).

## Data lineage (where live content actually comes from)
```
llm-wiki (output/website: prose pages + trust-bundle/*.json) ─┐
jvto-itinerary-core (generated/*: destinations, tours, pricing) ├─► jvto-web renders ─► help.jvto
knowledge-catalog-jvto-bootstrap (okf: packages, modules) ─────┘
        │  (this CMS repo extracts the same sources into data/releases/*)
        ▼
data/releases/* → consolidate.mjs → projection.json → build-pages.mjs (overlay) → build-seed.mjs
        → output/seed/load.sql → deploy-prod (deploy.yml) → DB jvto_cms → src/ Fastify API + /admin
```
Upstream repos (clone into `/workspace/<name>` when needed; same-owner `sambuko82` only — jvto-web is
`jvto-devteam`, cross-owner, cannot be added; not needed — llm-wiki IS what jvto-web renders):
`sambuko82/llm-wiki`, `sambuko82/jvto-itinerary-core`, `sambuko82/knowledge-catalog-jvto-bootstrap`.

## Page-copy overlay sources (in `scripts/build-pages.mjs`, per route)
- `data/releases/design-system/content-pages.json` — design-system IA copy (**SHORT** destination slugs).
- `data/releases/jvto-db/content-pages.json` — mirror of jvto-web DB (**LONG** destination slugs).
- `data/releases/help-live/content-pages.json` — scrape of 5 orphan live routes (markets/trust/blog).
- `data/releases/llm-wiki-website/content-pages.json` — **the SSOT** (prose bodies + composed destination
  facts). Built by `scripts/build-llm-wiki-website-extract.mjs` from `/workspace/llm-wiki/output/website`.
  **Authoritative for the audited GAP routes only** (`GAP_ROUTES` in build-pages) — never churns the
  ~85% of pages that already mirror live.

## Hard rules / canon (governance/canonical-facts.json → governance_facts)
- **Founding year = 2015. NEVER 2016.** (2016 = owner-locked-disputed PT date; "no invented incorporation
  date"; PT/NIB/TDUP era = 2023.) Sanitizers drop 2016 as a founding/incorporation year.
- **"Package Credit"**, never "Travel Credit" (already fixed on live).
- **Ijen (Kawah Ijen) elevation = 2,386 m** (not 2,769). Health screening framed **mandatory**.
- Facts-lock is **enforced on writes** (`src/factsGate.ts`) and **tested** on reads
  (`buildScanCorpus` scans h1/title/seo.title/designed sections + entities — it **skips `page_content`**,
  which is advisory imported copy). Keep forbidden values out of ENFORCED fields.

## Route/slug decision (settled)
Destination routes use the **CANONICAL LONG slug** — identical to live jvto-web AND llm-wiki `canonical_url`:
`/destinations/mount-bromo`, `/destinations/ijen-crater`, `/destinations/tumpak-sewu-waterfall`,
`/destinations/madakaripura-waterfall`, `/destinations/papuma-beach`. Set in `config/pages.yaml`
`generate.destinations.token_map`. Old short slugs (`/destinations/bromo|ijen|…`) 301-redirect to these.
Entity keys stay `destination:mount-bromo` / `destination:kawah-ijen` (decoupled from the route).

## Deployment (content → production)
`.github/workflows/deploy.yml` (`deploy-prod`) applies `output/seed/load.sql` to **`jvto_cms`** via the
`PROD_DATABASE_URL` repo secret on every push to `main` touching `output/seed/**`. Target = database
**`jvto_cms`** (NEVER `jvto_dev`). Secret form: `postgresql://USER:PASSWORD@HOST:5432/jvto_cms?sslmode=prefer`
— URL-encode `@` in the password as `%40`. Guard skips (no-op) until the secret is set. Operator console
edits (`editable=true`) are preserved across redeploys. App runruntime code (`src/`) is NOT auto-deployed
by this workflow (data only).

## Working method (execution contract)
1. **Check what already exists first; only fill the audited GAP; do not rebuild what's correct (~85% is).**
2. Real implementation with measurable proof (build report, `npm test`, live production) — not docs/plans that pile up.
3. Big, coherent changes — not tiny back-and-forth slices. Use judgment + prior context; minimize questions.
4. After any source/config edit: `npm run cms:build`, then commit the regenerated `output/` too
   (CI `verify:projection` requires byte-identical rebuild). Update count literals in `tests/runtime/runtime.test.ts`.

## Key commands
- Build the extract from llm-wiki: `LLM_WIKI_PATH=/workspace/llm-wiki node scripts/build-llm-wiki-website-extract.mjs` (manual; output committed).
- Full regenerate: `npm run cms:build`. Drift guard: `npm run verify:projection`. Gates: `npm run validate` + `npm run build`.
- DB tests need Postgres: init a local cluster (run PG as the `postgres` user, `-A trust`), then
  `TEST_DATABASE_URL=postgresql://postgres@localhost:5432/jvto_cms_local npm test`.

## Verify a change on live production (proof)
`curl https://jvto-cms.javavolcano-touroperator.com/pages/<route>` and `/pages` (after merge → deploy-prod).
