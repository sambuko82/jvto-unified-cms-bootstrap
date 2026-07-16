# Import, Conflict, Promotion and Publication Orchestration

## 1. Import state machine

```text
available
  → downloading
  → validating
  → staged
  → mapped
  → conflicted | approved
  → promoted
  → rolled_back
```

## 2. Import steps

1. Discover an immutable source release.
2. Download the artifact.
3. Verify checksum.
4. Validate manifest and schema version.
5. Create an import run.
6. Store each source record in staging.
7. Resolve canonical entity keys.
8. Calculate field-level changes.
9. Apply ownership policy.
10. Create blocking and non-blocking conflicts.
11. Reviewer approves promotion.
12. Promote governed fields or projections transactionally.
13. Record the active source version.

## 3. Publication state machine

```text
draft
  → in_review
  → changes_requested | approved
  → scheduled | published
  → superseded | archived
```

## 4. Publication gates

A publication is blocked when:

- unresolved blocking conflicts exist;
- required approvals are absent;
- page route/template is unsupported;
- a claim lacks verified evidence;
- policy document and machine rule disagree;
- package operational data is incomplete;
- private fields enter a public projection;
- an asset placement violates its role or zone;
- schema/canonical/FAQ validation fails.

## 5. Publication manifest

Every publication records:

- publication ID;
- actor and approvers;
- source release versions;
- entity/version pointers;
- affected routes;
- validation results;
- timestamp;
- previous pointers for rollback.

## 6. Rollback

Rollback changes current-version pointers back to the prior publication and revalidates affected routes. It does not delete history.
