# Deploying the CMS app code to production

`deploy.yml` ships **data** (the seed) to the `jvto_cms` database. This is the companion
that ships the **app** — the Fastify runtime in `src/` — to the live host, so runtime
features (e.g. `/admin/media`) actually appear on
`jvto-cms.javavolcano-touroperator.com`.

## Why it runs on a GitHub runner

The app runs on the VPS (same host as the database). A sandboxed agent can't reach the
box's SSH port, but a GitHub-hosted runner can — the same reason the DB deploy/sync run
there. The SSH password is stored ONLY as the encrypted repo secret `CMS_SSH_PASSWORD`
and handed to `sshpass` via env; it is never printed.

## One-time setup (owner)

Add the secret at **Settings → Secrets and variables → Actions → New repository secret**:

- Name: `CMS_SSH_PASSWORD`
- Value: the server's SSH password, pasted **raw** (no URL-encoding — that trick is only
  for the database URL).

Optional **Variables** (same page, Variables tab) — only if `inspect` shows a default is
wrong: `CMS_SSH_HOST` (default `31.97.223.43`), `CMS_SSH_USER` (default `root`),
`CMS_SSH_PORT` (default `22`), `CMS_APP_DIR`, `CMS_PM2_NAME`, `CMS_SYSTEMD_UNIT`.

Until the secret is set the workflow **skips** (no-op).

## Running it

Because an automation token can't press "Run workflow", the trigger is a commit to
`ops/deploy-app.run` whose first line is the mode:

| mode | effect |
|---|---|
| `inspect` | **read-only** — logs the app dir, process manager, DB-URL source, whether the box can `git fetch`. Changes nothing. |
| `deploy`  | fetch `main` on the box, `npm ci --include=dev`, `npm run build`, restart the process. |

**Always run `inspect` first** and read its artifact/step-summary. It confirms the two
things `remote-deploy.sh` assumes: the box can fetch from GitHub, and a pm2/systemd entry
restarts the app. If either is different, adjust the variables (or switch to an
rsync-from-runner deploy) before running `deploy`.

Each run uploads its log as an artifact and prints it to the job summary. `deploy` prints
an exact **rollback** recipe (reset to the previous commit + rebuild + restart) before it
changes anything.

## Files

- `.github/workflows/deploy-app.yml` — the guard-gated, mode-driven workflow.
- `scripts/deploy/remote-inspect.sh` — read-only host discovery.
- `scripts/deploy/remote-deploy.sh` — git-pull deploy + restart, with rollback output.
- `ops/deploy-app.run` — commit `inspect`/`deploy` here to fire the workflow.
