#!/usr/bin/env bash
# remote-deploy.sh — deploy the CMS app code on the production host, over SSH.
# Standard VPS flow: fetch this repo's main, hard-reset to it, install + build,
# restart the process. It NEVER touches the box's .env / secrets, and it prints an
# exact rollback recipe (the previous commit) before changing anything.
#
# Run `inspect` first: it confirms the two assumptions this script makes —
#   (1) the box can `git fetch` from origin, (2) a pm2/systemd entry restarts it.
# If inspect shows the box CANNOT fetch from GitHub, we switch to rsync-from-runner
# instead of this script (do not force this one).
#
# Optional env (workflow passes these from repo variables; all have safe defaults):
#   CMS_APP_DIR      explicit path to the checkout (else auto-discovered)
#   CMS_DEPLOY_BRANCH  branch to deploy (default: main)
#   CMS_PM2_NAME     pm2 app name to restart (else: restart all, or systemd)
#   CMS_SYSTEMD_UNIT systemd unit to restart (else auto-detected)
set -euo pipefail

BRANCH="${CMS_DEPLOY_BRANCH:-main}"

# ── 1) locate the app checkout ───────────────────────────────────────────────
APP_DIR="${CMS_APP_DIR:-}"
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR/.git" ]; then
  for base in /root /var/www /home /opt /srv /usr/share/nginx; do
    [ -d "$base" ] || continue
    while IFS= read -r gitdir; do
      d="$(dirname "$gitdir")"
      case "$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)" in
        *jvto-unified-cms-bootstrap*|*jvto-unified-cms*) APP_DIR="$d"; break 2;;
      esac
    done < <(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null)
  done
fi
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR/.git" ]; then
  echo "ERROR: could not locate the app checkout. Set the CMS_APP_DIR repo variable." >&2
  exit 3
fi
cd "$APP_DIR"
echo "app dir:  $APP_DIR"

# ── 2) capture rollback point BEFORE any change ──────────────────────────────
PREV="$(git rev-parse HEAD)"
echo "rollback: cd $APP_DIR && git reset --hard $PREV && npm ci --include=dev && npm run build && <restart>"
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "NOTE: working tree has local changes; they will be discarded by reset --hard (.env is untracked and safe)."
fi

# ── 3) fetch + hard-reset to the deployed branch ─────────────────────────────
if ! git ls-remote --heads origin >/dev/null 2>&1; then
  echo "ERROR: this box cannot fetch from origin (no GitHub credentials)." >&2
  echo "       Use the rsync-from-runner deploy path instead of git-pull." >&2
  exit 4
fi
git fetch --prune origin "$BRANCH"
git checkout -f "$BRANCH" 2>/dev/null || git checkout -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"
NEW="$(git rev-parse --short HEAD)"
echo "checked out: $BRANCH @ $NEW  (was ${PREV:0:7})"

# ── 4) install runtime + build deps, compile ─────────────────────────────────
# --include=dev because the build needs TypeScript (a devDependency); the running
# app only needs runtime deps, but ci is simplest and correct.
npm ci --include=dev
npm run build

# ── 5) restart under whatever supervises the process ─────────────────────────
restarted=""
if command -v pm2 >/dev/null 2>&1; then
  if [ -n "${CMS_PM2_NAME:-}" ]; then
    pm2 restart "$CMS_PM2_NAME" --update-env && restarted="pm2:$CMS_PM2_NAME"
  elif pm2 jlist 2>/dev/null | grep -q '"name"'; then
    pm2 restart all --update-env && restarted="pm2:all"
  fi
  [ -n "$restarted" ] && pm2 save 2>/dev/null || true
fi
if [ -z "$restarted" ] && command -v systemctl >/dev/null 2>&1; then
  UNIT="${CMS_SYSTEMD_UNIT:-}"
  if [ -z "$UNIT" ]; then
    UNIT="$(systemctl list-units --type=service --no-pager 2>/dev/null | grep -iE 'cms|jvto' | awk '{print $1}' | head -1)"
  fi
  if [ -n "$UNIT" ]; then
    sudo systemctl restart "$UNIT" 2>/dev/null || systemctl restart "$UNIT"
    restarted="systemd:$UNIT"
  fi
fi
if [ -z "$restarted" ]; then
  echo "WARN: built code is in place but no pm2/systemd entry was found to restart." >&2
  echo "      Set CMS_PM2_NAME or CMS_SYSTEMD_UNIT (inspect output shows the right one)." >&2
  exit 5
fi

echo "restarted via: $restarted"
echo "deploy complete: ${PREV:0:7} -> $NEW"
