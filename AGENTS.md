# Codex Operating Contract

## Mission

Build the JVTO Unified CMS as a governed control plane that extends the existing `jvto-web` application and JVTO PostgreSQL database.

## Non-negotiable constraints

- Do not create a second CMS runtime without a written architecture decision. (The in-repo editable control-plane CMS over `jvto_cms` — write API + admin console — is authorized by **ADR-008**; it is not the public website.)
- Do not replace the public website or booking engine.
- Do not make imported repository data editable by default.
- Do not overwrite source-owned fields silently.
- Do not let the CMS create unsupported static routes.
- Do not store arbitrary JSX, CSS, Tailwind classes, or executable code in CMS content.
- Do not expose private crew, customer, payment, authentication, or operational fields.
- Do not copy credentials, tokens, or passwords into the repository.
- Do not import mutable repository `main` content directly into production.
- Do not hardcode prices, ratings, policies, licence numbers, or operational facts in JSX.

## Execution contract (owner-directed)

Every step of work here produces (1) real running implementation — not notes or
references, (2) a measurable, verifiable change, and (3) proof of execution (curl output,
tests, or a visible result). Do not accumulate documentation without direct
implementation.

On obstacles: use judgment and prior context first, re-examine earlier data and
recommendations, and ask only for a true blocker (missing credentials, a
destructive/irreversible action, or a genuine fork).

Validate before executing a questionable directive: when an instruction — or a chosen
option — looks wrong, reconcile it against established context (the canonical facts, prior
decisions/ADRs, and earlier data) before acting. Surface the conflict rather than
executing blindly or silently overriding it, and resolve per the decision hierarchy below
— never on the newest instruction alone.

Goal: minimize questions, maximize execution, avoid blunders.

## Required architectural behavior

1. Every entity has a stable `canonical_key`.
2. Every relevant field has an owner source and write policy.
3. External data enters staging before promotion.
4. Every source release has a version, manifest, checksum, and validation result.
5. Publication uses append-only versions.
6. Published claims require verified evidence.
7. Verified proof files are immutable; replacement creates a new version.
8. Public renderers consume approved read models, not raw imports or drafts.
9. Route, schema, FAQ, and canonical validation reuse the existing `jvto-web` validators.
10. Ordinary content publication revalidates affected routes without requiring a full deployment.

## Decision hierarchy

When sources disagree, follow this order:

1. Security and legal constraints.
2. Field ownership registry.
3. Canonical operational PostgreSQL records.
4. Approved compiled source release.
5. Approved CMS editorial version.
6. Display-surface configuration.
7. Local fallback copy.

Never resolve a disagreement by choosing the newest timestamp alone.

## Implementation style

- TypeScript strict mode.
- PostgreSQL constraints over application-only assumptions.
- Small composable services.
- Server-side authorization and field filtering.
- Idempotent import jobs.
- Transactional promotion and publication.
- Explicit enums and state machines.
- Tests for source precedence, permission boundaries, and publication gates.
- Migrations must be additive until migration and rollback are proven.

## Required output for each implementation phase

- Architecture note.
- Migration files.
- Typed services.
- API or server-action contract.
- Tests.
- Acceptance checklist.
- Rollback instructions.
- Known limitations.

## Stop conditions

Stop and report rather than proceeding when:

- a production secret is found;
- the canonical owner cannot be determined;
- a migration risks deleting or rewriting operational data;
- a route is not represented in code or the page registry;
- a source release fails manifest or checksum validation;
- a policy document contradicts the active machine rule;
- a public payload includes restricted fields;
- a publication contains unresolved blocking conflicts.
