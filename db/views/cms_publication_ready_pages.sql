CREATE OR REPLACE VIEW cms_publication_ready_pages AS
SELECT
  p.id AS page_id,
  p.route,
  p.canonical_url,
  p.page_type,
  p.cluster,
  p.visual_mode,
  v.id AS version_id,
  v.version_number,
  v.workflow_status,
  NOT EXISTS (
    SELECT 1
    FROM integration_conflicts c
    WHERE c.entity_id = p.entity_id
      AND c.severity = 'blocking'
      AND c.resolution_status = 'open'
  ) AS has_no_blocking_conflicts
FROM cms_pages p
JOIN cms_entities e ON e.id = p.entity_id
JOIN cms_page_versions v ON v.id = e.current_version_id;
