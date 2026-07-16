# Acceptance Criteria

## Governance

- Every critical entity has one canonical key and owner source.
- Critical fields have explicit write and conflict policies.
- Imported non-owner values never silently overwrite owner values.

## Integration

- Every promoted source has a version, commit/release reference, manifest, checksum, and validation status.
- Imports are idempotent.
- Invalid releases cannot alter approved data.
- Previous promoted source release can be restored.

## Pages

- Every published page has a route, canonical URL, page role, cluster, template, visual mode, and version.
- CMS cannot publish unsupported static routes.
- Sections are restricted by template and cluster contract.

## Products

- Package price, itinerary, and operational relations remain operationally owned.
- Editorial copy cannot overwrite operational fields.
- Package publication fails on blocking readiness gaps.

## Trust

- Every public claim has approved wording and linked evidence.
- Every proof asset has verification status and canonical owner.
- Teaser placements link back to canonical proof.

## Policy

- Public policy documents match active machine rules.
- Effective dates and approvals are valid.
- Superseded policy versions remain accessible in audit history.

## Security

- No tracked secrets.
- Private crew/customer/payment fields are excluded server-side from public payloads.
- Permissions are enforced on the server.

## Publication

- Every published change has an actor, approval record, validation report, and rollback pointer.
- Unresolved blocking conflicts stop publication.
- Affected routes are revalidated.
