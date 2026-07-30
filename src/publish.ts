// src/publish.ts — "Publish to live": push the edited jvto_cms into jvto_dev (the DB behind
// help.javavolcano-touroperator.com), then optionally trigger a jvto-web rebuild.
//
// This runs the SAME sync as .github/workflows/sync-jvto-dev.yml (scripts/sync-to-jvto-dev.mjs),
// but from the app process. The app shares a host with both databases, so JVTO_DEV_DATABASE_URL
// points at localhost:5432 — which sidesteps the intermittent connect-timeouts seen when the
// GitHub runner reaches the box's :5432 from outside. The sync is additive, idempotent, and
// writes a rollback.sql per run.
//
// Configuration (app env, e.g. pm2):
//   JVTO_DEV_DATABASE_URL  (required for live publish) — target jvto_dev, e.g.
//     postgresql://USER:PASS@localhost:5432/jvto_dev?sslmode=disable
//   JVTO_WEB_DEPLOY_HOOK   (optional) — a URL POSTed after a successful sync to rebuild
//     jvto-web (e.g. a Vercel/Netlify deploy hook). Until it is set, the sync still runs and
//     the content lands in jvto_dev; only the automatic rebuild is skipped.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

// Resolved relative to this module. At runtime the app is compiled to dist/publish.js, so
// `../scripts` and `../output` land at the repo root (scripts/ and node_modules ship with the box).
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SYNC_SCRIPT = fileURLToPath(new URL('../scripts/sync-to-jvto-dev.mjs', import.meta.url));
const REPORT_MD = fileURLToPath(new URL('../output/sync/jvto-dev-report.md', import.meta.url));

export interface RebuildResult {
  configured: boolean; // JVTO_WEB_DEPLOY_HOOK present
  ok: boolean; // the POST succeeded
  detail: string; // human-readable status
}

export interface PublishResultData {
  ok: boolean; // sync succeeded (the content is live in jvto_dev)
  configured: boolean; // JVTO_DEV_DATABASE_URL present
  syncLog: string; // stdout tail from the sync script
  report: string; // output/sync/jvto-dev-report.md (insert/update/preserve counts)
  rebuild: RebuildResult;
  error?: string;
}

const notConfigured = (error: string): PublishResultData => ({
  ok: false,
  configured: false,
  syncLog: '',
  report: '',
  rebuild: { configured: Boolean(process.env.JVTO_WEB_DEPLOY_HOOK), ok: false, detail: 'skipped' },
  error,
});

/**
 * Publish every jvto_cms edit to the live jvto_dev database, then (if configured) trigger a
 * jvto-web rebuild. Never throws — failures come back on the returned object so the console
 * can render them. Facts-lock and editable=true already applied at write time; this only moves
 * the already-governed rows downstream.
 */
export async function publishToLive(): Promise<PublishResultData> {
  const devUrl = process.env.JVTO_DEV_DATABASE_URL;
  const cmsUrl = process.env.CMS_DATABASE_URL || process.env.DATABASE_URL;
  if (!devUrl) {
    return notConfigured(
      'JVTO_DEV_DATABASE_URL is not set on the app — cannot publish to the live database yet. ' +
        'Set it (target jvto_dev, e.g. postgresql://…@localhost:5432/jvto_dev?sslmode=disable) to enable Publish.',
    );
  }
  if (!cmsUrl) {
    return { ...notConfigured('DATABASE_URL (source jvto_cms) is not set.'), configured: true };
  }

  // 1) sync jvto_cms → jvto_dev (over localhost on the shared host)
  const runId = 'admin-' + new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  let syncLog = '';
  try {
    const { stdout } = await execFileAsync('node', [SYNC_SCRIPT], {
      cwd: REPO_ROOT,
      timeout: 120_000,
      env: { ...process.env, CMS_DATABASE_URL: cmsUrl, JVTO_DEV_DATABASE_URL: devUrl, SYNC_RUN_ID: runId },
    });
    syncLog = stdout.trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      configured: true,
      syncLog: '',
      report: '',
      rebuild: { configured: Boolean(process.env.JVTO_WEB_DEPLOY_HOOK), ok: false, detail: 'skipped (sync failed)' },
      error: `Sync to jvto_dev failed: ${message}`,
    };
  }

  let report = '';
  try {
    report = (await readFile(REPORT_MD, 'utf8')).trim();
  } catch {
    // report is best-effort; the sync already committed if we got here
  }

  // 2) trigger the jvto-web rebuild (optional, pluggable)
  const rebuild = await triggerRebuild();
  return { ok: true, configured: true, syncLog, report, rebuild };
}

/** POST the jvto-web deploy hook if configured. A missing hook is not an error — the content
 * is already in jvto_dev; only the automatic static rebuild is deferred. */
async function triggerRebuild(): Promise<RebuildResult> {
  const hook = process.env.JVTO_WEB_DEPLOY_HOOK;
  if (!hook) {
    return {
      configured: false,
      ok: false,
      detail: 'JVTO_WEB_DEPLOY_HOOK not set — jvto-web will not auto-rebuild yet.',
    };
  }
  try {
    const res = await fetch(hook, { method: 'POST' });
    let host = 'deploy hook';
    try {
      host = new URL(hook).host;
    } catch {
      /* keep the generic label if the hook is not a parseable URL */
    }
    return { configured: true, ok: res.ok, detail: `POST ${host} → HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { configured: true, ok: false, detail: `rebuild hook POST failed: ${message}` };
  }
}
