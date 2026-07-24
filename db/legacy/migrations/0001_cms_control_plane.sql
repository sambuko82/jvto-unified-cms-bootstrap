BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE cms_entity_status AS ENUM ('active','draft','archived','deprecated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cms_workflow_status AS ENUM ('draft','in_review','changes_requested','approved','scheduled','published','superseded','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE integration_record_status AS ENUM ('received','validated','unmapped','mapped','conflicted','approved','promoted','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE cms_conflict_severity AS ENUM ('info','warning','blocking');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS integration_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  source_type text NOT NULL,
  role text NOT NULL,
  repository text,
  authority_rank integer NOT NULL DEFAULT 0,
  manifest_required boolean NOT NULL DEFAULT true,
  checksum_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES integration_sources(id),
  version text NOT NULL,
  commit_sha text,
  release_tag text,
  schema_version integer NOT NULL,
  manifest jsonb NOT NULL,
  checksum_manifest jsonb,
  produced_at timestamptz NOT NULL,
  validation_status text NOT NULL DEFAULT 'pending',
  import_status text NOT NULL DEFAULT 'available',
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, version)
);

CREATE TABLE IF NOT EXISTS integration_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES integration_releases(id),
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  record_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  report jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS cms_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  canonical_key text NOT NULL,
  canonical_source_id uuid REFERENCES integration_sources(id),
  local_table text,
  local_record_id text,
  locale text NOT NULL DEFAULT 'en',
  status cms_entity_status NOT NULL DEFAULT 'active',
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, canonical_key, locale)
);

CREATE TABLE IF NOT EXISTS cms_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  alias_type text NOT NULL,
  alias_value text NOT NULL,
  source_id uuid REFERENCES integration_sources(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(alias_type, alias_value)
);

CREATE TABLE IF NOT EXISTS cms_entity_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  to_entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  sort_order integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_entity_id, relation_type, to_entity_id)
);

CREATE TABLE IF NOT EXISTS cms_field_ownership_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  field_path text NOT NULL,
  owner_source_id uuid NOT NULL REFERENCES integration_sources(id),
  write_policy text NOT NULL,
  approval_role text,
  conflict_policy text NOT NULL,
  freshness_days integer,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, field_path, effective_from)
);

CREATE TABLE IF NOT EXISTS integration_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id uuid NOT NULL REFERENCES integration_import_runs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES integration_sources(id),
  external_key text NOT NULL,
  entity_type text NOT NULL,
  canonical_entity_id uuid REFERENCES cms_entities(id),
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  status integration_record_status NOT NULL DEFAULT 'received',
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(import_run_id, external_key)
);

CREATE TABLE IF NOT EXISTS integration_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid NOT NULL REFERENCES integration_source_records(id) ON DELETE CASCADE,
  entity_id uuid REFERENCES cms_entities(id),
  field_path text,
  conflict_type text NOT NULL,
  severity cms_conflict_severity NOT NULL,
  owner_value jsonb,
  incoming_value jsonb,
  resolution_status text NOT NULL DEFAULT 'open',
  resolution jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL UNIQUE REFERENCES cms_entities(id) ON DELETE CASCADE,
  page_key text NOT NULL UNIQUE,
  route text NOT NULL UNIQUE,
  canonical_url text NOT NULL,
  page_type text NOT NULL,
  cluster text NOT NULL,
  page_role text NOT NULL,
  route_ownership text NOT NULL,
  template_key text NOT NULL,
  visual_mode text NOT NULL,
  faq_source text NOT NULL DEFAULT 'none',
  schema_profile jsonb NOT NULL DEFAULT '[]'::jsonb,
  route_status text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES cms_pages(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  workflow_status cms_workflow_status NOT NULL DEFAULT 'draft',
  title text,
  h1 text,
  summary text,
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  structured_data_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  approved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  published_at timestamptz,
  UNIQUE(page_id, version_number)
);

ALTER TABLE cms_entities
  ADD CONSTRAINT cms_entities_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES cms_page_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS cms_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_version_id uuid NOT NULL REFERENCES cms_page_versions(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  section_type text NOT NULL,
  variant text NOT NULL,
  sort_order integer NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  referenced_entity_ids uuid[] NOT NULL DEFAULT '{}',
  referenced_asset_ids text[] NOT NULL DEFAULT '{}',
  visibility_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(page_version_id, section_key)
);

CREATE TABLE IF NOT EXISTS cms_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_status cms_workflow_status NOT NULL DEFAULT 'approved',
  actor_id text NOT NULL,
  approver_ids text[] NOT NULL DEFAULT '{}',
  source_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_routes text[] NOT NULL DEFAULT '{}',
  validation jsonb NOT NULL,
  published_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_publication_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES cms_publications(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES cms_entities(id),
  version_id uuid NOT NULL,
  previous_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publication_id, entity_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL,
  action text NOT NULL,
  entity_id uuid REFERENCES cms_entities(id),
  request_id text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_records_entity ON integration_source_records(canonical_entity_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_open ON integration_conflicts(resolution_status, severity);
CREATE INDEX IF NOT EXISTS idx_page_versions_status ON cms_page_versions(workflow_status);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_id, created_at DESC);

COMMIT;
