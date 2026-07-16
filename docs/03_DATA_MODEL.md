# Target Data Model

## 1. Existing tables to preserve

- packages and package relations
- package prices
- itinerary days and details
- destinations and route data
- routes and route details
- bookings and payments
- hotels and room types
- crew and roles
- reviews and review stats
- assets, folders and tags

## 2. New orchestration tables

### Governance

- `cms_entities`
- `cms_entity_aliases`
- `cms_entity_relations`
- `cms_external_identifiers`
- `cms_entity_source_links`
- `cms_field_ownership_rules`

### Integration

- `integration_sources`
- `integration_releases`
- `integration_import_runs`
- `integration_source_records`
- `integration_record_mappings`
- `integration_validation_results`
- `integration_conflicts`
- `integration_promotion_batches`

### Pages and content

- `cms_pages`
- `cms_page_versions`
- `cms_section_types`
- `cms_section_variants`
- `cms_page_sections`
- `cms_display_surfaces`
- `cms_surface_bindings`

### Domain presentation

- `cms_package_content_versions`
- `cms_package_route_profiles`
- `cms_destination_content_versions`
- `cms_support_topics`
- `cms_support_topic_versions`
- `cms_support_bindings`
- `cms_people_profiles`
- `cms_people_profile_versions`
- `cms_review_features`
- `cms_review_themes`

### Trust and compliance

- `cms_evidence_items`
- `cms_claim_evidence`
- `cms_proof_groups`
- `cms_proof_placements`
- `cms_verification_checks`
- `cms_policy_rules`
- `cms_policy_rule_versions`
- `cms_policy_document_rules`

### Assets and design

- `cms_asset_roles`
- `cms_asset_placements`
- `cms_asset_derivatives`
- `cms_asset_verifications`
- `cms_asset_rights`
- `cms_asset_entity_links`
- `cms_design_system_versions`
- `cms_component_registry`
- `cms_visual_modes`
- `cms_template_contracts`

### Workflow and audit

- `cms_workflow_events`
- `cms_approvals`
- `cms_publications`
- `cms_publication_items`
- `cms_rollbacks`
- `audit_events`
- `audit_field_changes`

## 3. Identifier policy

- Preserve existing BigInt IDs in operational tables.
- Use UUID for new CMS and orchestration tables.
- Use stable text `canonical_key` across repositories.
- Never expose database IDs as the cross-repository contract.

## 4. Version policy

Published content is append-only. A modification creates a new version and never edits the previously published version in place.

## 5. JSONB policy

Use JSONB only for bounded structures with a schema contract. Core relationships, workflow, ownership, and critical query fields must remain relational.

## 6. EAV policy

Do not expand generic EAV as the main CMS model. Use typed tables plus controlled JSONB and the canonical entity registry.
