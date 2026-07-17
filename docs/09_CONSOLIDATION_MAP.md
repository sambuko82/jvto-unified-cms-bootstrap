# 09 · Consolidation Map

How every JVTO repository's compiled output consolidates into CMS canonical
entities. This document is the human-readable companion to the machine-checkable
`config/consolidation-map.yaml` (validated by `npm run validate:config`, which
cross-checks it against `source-registry.yaml`, `field-ownership.yaml`, and
`entity-types.yaml`) and the engine in `src/integration/` that executes it.

## Dependency direction

```
llm-wiki (narrative / policy / trust SSOT)  ─┐
jvto-itinerary-core (operational SSOT)       ─┤→ knowledge-catalog OKF (normalized)
                                              │  design-system (CMS-ready seed)
                                              └────────────→ jvto-web Prisma tables
                          docs/CANONICAL_FACTS.md  =  final tie-breaker over all
```

The control plane never becomes a new source of truth (`AGENTS.md`, ADR-004): it
unifies **access + publication**, preserving each upstream owner.

## Sources → entities → owned fields

| Source (authority) | Artifact | Entity type | Owned field(s) |
|---|---|---|---|
| `llm-wiki-trust` (85) | `trust-bundle/claims.json` | `claim` | `canonical_wording` |
| `llm-wiki-trust` (85) | `trust-bundle/faq.json` | `faq` | `*` |
| `llm-wiki-trust` (85) | `trust-bundle/people.json` | `public_person_profile` | `*` |
| `llm-wiki-trust` (85) | `trust-bundle/destinations.json` | `destination` | `narrative` |
| `llm-wiki-policy` (85) | `policy-bundle/decision-matrix.json` (+ `customer-copy.json`) | `policy_document` | `decision_matrix`, `customer_copy`, `payment_methods` |
| `itinerary-core` (85) | `package-catalog-index.json` | `package` | `route_sequence` |
| `itinerary-core` (85) | `22-destinations-master.json` | `destination` | `operational` |
| `itinerary-core` (85) | `11-package-route-map.json` | `route` | `*` |
| `knowledge-catalog-okf` (82) | `customer-sales-release/package-profiles.json` | `package` | `profile`, `module_refs` |
| `knowledge-catalog-okf` (82) | `customer-sales-release/general-modules.json` | `general_module` | `*` |
| `design-system` (70) | `handoff/seed/01_content_pages_v2.sql` | `page` | `content` |
| `canonical-facts` (100) | `docs/CANONICAL_FACTS.md` | `policy_document` | `adjudicated_facts` |
| `postgres-operational` (100) | live DB | `package` | `price_tiers` (block — money) |

## Join keys (multi-form → one canonical key)

Canonical key convention: **`<entity_type>:<slug>`** (e.g. `package:bromo-ijen-3d2n`).
`src/integration/canonical.ts#normalizeSlug` collapses every form to one slug.

- **Package** — bare `bromo-1d1n` · origin `bali/bromo-ijen-3d2n` · full-path
  `tours/from-surabaya/bromo-1d1n` · `public_url` `/tours/from-bali/bromo-ijen-3d2n`.
  Bridges: itinerary-core `package-catalog-index.json.source_trace → llm-wiki`;
  okf `package-profiles.json.itinerary_core_package_id → itinerary-core`.
- **Destination** — token `kawah-ijen|ijen`, `mount-bromo|bromo`, `tumpak-sewu`, …
- **Person** — schema `@id` `/#agung-sambuko`, `/#dr-ahmad-irwandanu`, `/#crew-{code}`.
- **Claim / evidence** — `C1`..`C9` + `E001…` / `proof_ids`.
- **Policy / module** — `cancellation-package-credit` ↔ okf `policies/…` ↔ `module_id: policy_…`.
- **Page** — `route` (`/`, `/travel-guide/…`), the `content_pages(route,lang)` key.

## How it resolves (precedence)

Field-level precedence follows `AGENTS.md`'s decision hierarchy, executed by
`decideIncomingFieldChange` (`src/services/source-precedence.ts`):

1. Owner source supplies the field → **accept** (or **require_approval** for
   `override_with_approval`, e.g. `claim.canonical_wording`).
2. Non-owner contradicts an owned field → per `conflict_policy`: `block` (money,
   adjudicated facts), `prefer_owner` (compiler content — owner stays active,
   incoming kept as context), `manual_resolution`, `create_new_version`.
3. `canonical-facts` (authority 100) wins on adjudicated figures (founding 2015,
   deposit 20%, reviews 4.8/51 · 4.9/123 · 4.95/21 · 195, health mandatory).

## Wire format & download boundary

Sources deliver **immutable GitHub releases** (`source-release.schema.json`
manifest + sha256-checksummed files; per-record `import-record.schema.json`).
The engine here consumes committed **release bundles** (see
`examples/consolidation/*`) and performs real checksum verification, mapping,
conflict detection, projection, and publication — deterministically and without
network or clock. The **live release download** (GitHub API) is intentionally
out of scope for this repo and belongs to the jvto-web importer runtime
(`integration/jvto-web/TARGET_INTEGRATION.md`), so the pipeline stays pure and
CI-testable.

## Projection → DB

Approved entities project into the typed tables added by
`db/migrations/0002_cms_domain_entities.sql` (`cms_package_content_versions`,
`cms_destination_content_versions`, `cms_people_profiles`, `cms_policy_rules`,
`cms_policy_documents`, `cms_evidence_items`, `cms_claim_evidence`,
`cms_proof_groups`, `cms_faq_entries`, `cms_review_features`,
`cms_general_modules`), keyed to the `cms_entities` registry via `entity_id`,
with cross-repo ids in `cms_external_identifiers`. A schema-valid
`publication-manifest` (gated by `evaluatePublication`) records what publishes.
