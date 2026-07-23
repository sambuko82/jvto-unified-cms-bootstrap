# 10 — Static CMS Projection (DB-free, live-free)

A standalone, browsable projection of the JVTO CMS, built entirely inside this
repo from the consolidated repo estate — **no database, no live website, no
server**. It *extracts* every source repo's compiled output and *maps* it into
the CMS taxonomy, then renders it as an artifact you open in a browser.

See **ADR-007** for why this is a build artifact, not a runtime.

## The pipeline (4 pure steps)

```
sibling repos ──build:bundles──▶ data/releases/*     (immutable, checksummed)
                                       │
                                  consolidate         (the existing engine)
                                       ▼
                          output/cms-projection/projection.json
                                       │
                                    render
                                       ▼
                          output/cms-projection/index.html   ◀── open this
```

| Step | Script | Reads | Writes |
|------|--------|-------|--------|
| Extract | `scripts/build-release-bundles.mjs` | sibling repo compiled outputs (llm-wiki trust/policy bundles, okf release, itinerary-core generated, design-system seed) | `data/releases/<source>/{records.json,manifest.json}` + `_index.json` |
| Cross-check | `scripts/crosscheck-bundles.mjs` | built bundles vs `jvto-web/src/data/*` | drift report (exit 1 on mismatch) |
| Map | `scripts/consolidate.mjs` | `data/releases/*` + `config/*.yaml` | `output/cms-projection/projection.json` |
| Render | `scripts/render-cms.mjs` | `projection.json` + taxonomy | `output/cms-projection/index.html` |

The **extract** step is the only one that reads outside this repo; it runs at
authoring time and its output (the bundles) is committed as the artifact of
record (ADR-004). Everything downstream is pure over committed files, so CI
re-runs **map + render** and fails on any drift (`npm run verify:projection`).

## Commands

```bash
npm run build:bundles      # regenerate data/releases/* from the sibling repos
npm run crosscheck         # verify bundles match jvto-web/src/data (no fact drift)
npm run cms:build          # build + consolidate + render
npm run verify:projection  # consolidate + render + git-diff drift guard (CI)
```

Point the extractor at other checkouts with `LLM_WIKI_DIR`, `ITINERARY_DIR`,
`OKF_DIR`, `DESIGN_DIR`; the cross-check with `JVTO_WEB_DIR`.

## What the projection contains

176 canonical entities (deterministic), grouped in `index.html` by visual-mode
cluster → entity type → entity. Each field shows its **value**, **owning
source**, and **field-ownership write-policy** badge:

| Cluster | Entity types (with real data) |
|---------|-------------------------------|
| Content & System | `page` (4) |
| Travel | `package` (16, Bali+Surabaya variants), `destination` (10), `route` (18), `activity` (18) |
| Trust & Proof | `claim` (C1–C9), `public_person_profile` (16), `policy_document` (9) |
| Support & Narrative | `faq` (9), `general_module` (67) |

## Governance preserved

- **Read-only.** Nothing here is editable; edits happen upstream and re-consolidate.
- **Ownership is explicit.** Every field is badged `read_only` / `editable` /
  `operational_only` / `compliance_only` per `config/field-ownership.yaml`.
- **Facts-lock wins.** `canonical-facts` is the tie-breaker; the extractor
  corrects retired wording (e.g. Ijen health screening is **mandatory**, never
  conditional) so no stale fact reaches the projection.
- **No private fields.** The publication gate scans for private-field markers;
  the projection renders only gate-passed entities.
