# Security Baseline

## Mandatory before implementation

1. Revoke and rotate every credential previously committed or documented in plaintext.
2. Remove secrets from tracked files.
3. Purge secrets from Git history.
4. Enable GitHub secret scanning and push protection.
5. Store production secrets in the deployment environment or a secret manager.
6. Review service logs for misuse.
7. Confirm least-privilege database and API credentials.

## Application controls

- Server-side RBAC.
- Server-side field visibility.
- CSRF protection for mutations.
- Session expiry and revocation.
- Rate limiting on sensitive endpoints.
- Audit all write, approval, publication, and source-promotion actions.
- Encrypt sensitive backups.
- Do not log tokens, passwords, payment payloads, or personal data.

## Repository controls

- `.env*` ignored except `.env.example`.
- Validation workflow scans common secret patterns.
- Pull requests required for schema, ownership, and publication-gate changes.
- CODEOWNERS recommended for security, policies, migrations, and publishing modules.
