-- db/core/schema.sql — JVTO CMS core schema (the drop-in base).
--
-- Concept: 2 stores + 1 resolver.
--   entities        = content atoms consolidated from llm-wiki + jvto-itinerary-core
--                     + knowledge-catalog-okf + jvto_dev (single authoritative source,
--                     provenance-tagged) — see output/cms-projection/projection.json.
--   pages/sections  = the page IA + block composition from jvto-new-on-design-system.
--   resolver        = route -> page -> ordered sections -> hydrated entity_refs.
--
-- Supersedes the 28-table multi-source governance schema: a single authoritative
-- source needs no staging / ownership / conflict / precedence / workflow /
-- publication-manifest tables. Typed columns + bounded JSONB, NO EAV.
--
-- Fresh Postgres only (never jvto_dev / the jvto-web DB). Idempotent (IF NOT EXISTS).
-- gen_random_uuid() is core in PostgreSQL 13+.

-- ── 1) Content atoms ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   text NOT NULL,              -- package|destination|route|activity|claim|faq|public_person_profile|policy_document|general_module|page
  canonical_key text NOT NULL UNIQUE,       -- "<type>:<slug>"
  slug          text,
  title         text,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { field: value }
  provenance    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { field: source }
  source        text,                        -- dominant owning source
  editable      boolean NOT NULL DEFAULT false,       -- false = read-only synced from an upstream repo
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entities_type_idx ON entities(entity_type);

-- ── 2) IA: pages (routes) + sections (block composition) ──────────────────────
CREATE TABLE IF NOT EXISTS pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route        text NOT NULL UNIQUE,
  file_group   text NOT NULL,               -- 001..009 (design-system FILE grouping)
  sort_order   int  NOT NULL DEFAULT 0,
  cluster      text,                         -- homepage|travel|trust|hybrid
  page_type    text NOT NULL,               -- homepage|hub|tour|destination|travel_guide|verify|policy|narrative|faq|contact|blog|crew_profile
  template     text,                         -- ui_kits/website template key
  visual_mode  text,                         -- homepage|travel|trust|hybrid
  hub_route    text,                         -- parent hub (NULL for hubs / home)
  title        text,
  h1           text,
  seo          jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { title, description, schema_type, schema_json }
  status       text NOT NULL DEFAULT 'published',
  editable     boolean NOT NULL DEFAULT false          -- true = console-edited (upstream refresh must NOT clobber)
);
CREATE INDEX IF NOT EXISTS pages_group_idx ON pages(file_group, sort_order);

CREATE TABLE IF NOT EXISTS page_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id      uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  sort_order   int  NOT NULL DEFAULT 0,
  section_type text NOT NULL,               -- hero|section_head|rich_text|callout|steps|vantage|dest_facts|data_box|timeline|faq_list|card_grid|cta
  variant      text,                         -- e.g. callout: default|lime|alert-gold|on-dark ; card_grid: tour|package|landscape|review|crew|proof
  content      jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_refs  text[] NOT NULL DEFAULT '{}', -- canonical_keys hydrated at resolve time
  asset_refs   text[] NOT NULL DEFAULT '{}',
  editable     boolean NOT NULL DEFAULT false, -- true = console-edited (upstream refresh must NOT clobber)
  UNIQUE(page_id, sort_order)
);

-- ── 3) Redirects (legacy → canonical) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS redirects (
  from_path text PRIMARY KEY,
  to_path   text NOT NULL,
  code      int  NOT NULL DEFAULT 301
);

-- ── 4) Governance facts (facts-lock, self-contained; no jvto-web) ─────────────
CREATE TABLE IF NOT EXISTS governance_facts (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

-- ── 5) Assets (minimal media registry) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind  text,
  url   text NOT NULL,
  alt   text,
  meta  jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── 6) Audit log (console write/publish actions; no secrets or personal data) ──
CREATE TABLE IF NOT EXISTS audit_log (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL,               -- admin identity; never a token/secret
  action   text NOT NULL,               -- patch_page | put_section | publish
  target   text NOT NULL,               -- route, or route#section_type
  summary  text                         -- short human note; no restricted fields
);

-- ── Idempotent migrations for already-provisioned databases ───────────────────
-- (CREATE TABLE IF NOT EXISTS above is a no-op on an existing DB, so new columns
--  are added here.) `editable` marks console-edited rows the upstream refresh keeps.
ALTER TABLE pages         ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false;
ALTER TABLE page_sections ADD COLUMN IF NOT EXISTS editable boolean NOT NULL DEFAULT false;

-- ── Read model: page + ordered sections (resolver hydrates entity_refs in app) ─
CREATE OR REPLACE VIEW page_render AS
SELECT p.route, p.file_group, p.sort_order, p.cluster, p.page_type, p.visual_mode,
       p.hub_route, p.title, p.h1, p.seo,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'sort_order', s.sort_order, 'type', s.section_type, 'variant', s.variant,
             'content', s.content, 'entity_refs', s.entity_refs, 'asset_refs', s.asset_refs
           ) ORDER BY s.sort_order
         ) FILTER (WHERE s.id IS NOT NULL),
         '[]'::jsonb
       ) AS sections
FROM pages p
LEFT JOIN page_sections s ON s.page_id = p.id
GROUP BY p.id;
