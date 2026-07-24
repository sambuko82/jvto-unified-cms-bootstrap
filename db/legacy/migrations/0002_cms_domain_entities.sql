-- 0002_cms_domain_entities.sql
-- Additive migration: typed projection + cross-repo identity tables for the
-- consolidated entity model produced by src/integration (the control-plane
-- engine). Every table hangs off the cms_entities registry created in 0001 via
-- entity_id, and mirrors the shapes the jvto-web Prisma models ultimately
-- consume (packages, destinations, people, reviews, policies, trust, faqs).
--
-- SAFETY: additive only. No column drops, no type changes, no data mutation on
-- existing tables. All CREATE ... IF NOT EXISTS + guarded enums, so the file is
-- idempotent and re-runnable.
--
-- ROLLBACK: drop the objects created here in reverse dependency order (see the
-- rollback block at the bottom, commented out). No 0001 object is touched, so
-- rolling 0002 back cannot affect the base control plane.

BEGIN;

-- Cross-repo external identifiers: the multi-form join keys (package bare-slug /
-- origin-prefixed / full-path / public_url, destination token, person @id,
-- claim id, policy id) all resolve to one cms_entities row.
CREATE TABLE IF NOT EXISTS cms_external_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  source_code text NOT NULL,
  id_kind text NOT NULL,               -- e.g. 'bare_slug','origin_prefixed','full_path','public_url','schema_id','claim_id'
  id_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id_kind, id_value)
);
CREATE INDEX IF NOT EXISTS idx_external_identifiers_entity ON cms_external_identifiers(entity_id);

-- Maps a staged integration_source_record to the cms_entity it resolved to,
-- with the accepted field decisions (the audit trail of the mapper).
CREATE TABLE IF NOT EXISTS integration_record_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id uuid,               -- FK to integration_source_records(id) when present
  entity_id uuid REFERENCES cms_entities(id) ON DELETE SET NULL,
  canonical_key text NOT NULL,
  field_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  had_blocking_conflict boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_record_mappings_entity ON integration_record_mappings(entity_id);

-- Package presentation content (operational price_tiers stay in the legacy
-- operational table; this holds the compiled/editorial projection only).
CREATE TABLE IF NOT EXISTS cms_package_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  workflow_status cms_workflow_status NOT NULL DEFAULT 'draft',
  slug text NOT NULL,
  public_url text,
  origin text,
  duration text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  route_sequence jsonb NOT NULL DEFAULT '[]'::jsonb,
  module_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, version_number)
);

CREATE TABLE IF NOT EXISTS cms_destination_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  workflow_status cms_workflow_status NOT NULL DEFAULT 'draft',
  token text NOT NULL,
  narrative text,
  operational jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, version_number)
);

CREATE TABLE IF NOT EXISTS cms_people_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  schema_id text NOT NULL,             -- /#agung-sambuko, /#crew-{code}
  name text NOT NULL,
  job_title text,
  is_crew boolean NOT NULL DEFAULT false,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id)
);

-- Trust: claims are in cms_entities; evidence + proof + the claim↔evidence graph.
CREATE TABLE IF NOT EXISTS cms_evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES cms_entities(id) ON DELETE CASCADE,
  evidence_code text NOT NULL UNIQUE,  -- E001..
  evidence_type text NOT NULL,
  source_file text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_proof_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES cms_entities(id) ON DELETE CASCADE,
  proof_code text NOT NULL UNIQUE,     -- P001..
  label text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_claim_evidence (
  claim_entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES cms_evidence_items(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_entity_id, evidence_id)
);

-- Policy: the compiled decision matrix + customer copy + payment methods (v2)
-- as an approved projection; the machine logic stays owned by llm-wiki-policy.
CREATE TABLE IF NOT EXISTS cms_policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  workflow_status cms_workflow_status NOT NULL DEFAULT 'draft',
  policy_id text NOT NULL,             -- cancellation-package-credit, booking-paths, anti-fraud
  policy_version text,
  decision_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_methods jsonb NOT NULL DEFAULT '{}'::jsonb,
  adjudicated_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id, version_number)
);

CREATE TABLE IF NOT EXISTS cms_policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  document_type text NOT NULL,         -- booking_payment_cancellation | inclusions_exclusions | privacy
  title text NOT NULL,
  body_md text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS cms_faq_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text NOT NULL,
  source_claim_id text,                -- C1..C9
  target_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_id)
);

CREATE TABLE IF NOT EXISTS cms_review_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  platform text NOT NULL,
  rating numeric(3,2),
  review_count integer,
  rating_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reusable OKF content modules (general_module) applied to packages.
CREATE TABLE IF NOT EXISTS cms_general_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES cms_entities(id) ON DELETE CASCADE,
  module_id text NOT NULL UNIQUE,      -- policy_anti_fraud, destination_ijen
  category text,
  scope text,
  title text,
  short_answer text,
  customer_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_policy ON cms_policy_rules(policy_id, workflow_status);
CREATE INDEX IF NOT EXISTS idx_package_content_slug ON cms_package_content_versions(slug);
CREATE INDEX IF NOT EXISTS idx_faq_claim ON cms_faq_entries(source_claim_id);

COMMIT;

-- ============================================================================
-- ROLLBACK (manual; run inside a transaction if 0002 must be reverted):
-- BEGIN;
--   DROP TABLE IF EXISTS cms_general_modules, cms_review_features, cms_faq_entries,
--     cms_policy_documents, cms_policy_rules, cms_claim_evidence, cms_proof_groups,
--     cms_evidence_items, cms_people_profiles, cms_destination_content_versions,
--     cms_package_content_versions, integration_record_mappings,
--     cms_external_identifiers CASCADE;
-- COMMIT;
-- No 0001 object is affected.
-- ============================================================================
