#!/usr/bin/env bash
# remote-deploy.sh — deploy the CMS app code on the production host, over SSH.
# Standard VPS flow: fast-forward this repo's main, install + build, restart ONLY the
# pm2 process that runs from this checkout. It NEVER touches the box's env/secrets
# (ecosystem.config.cjs / .env are untracked and left alone), never force-discards, and
# prints an exact rollback recipe (the previous commit) before changing anything.
#
# Tuned from the inspect run on jvto-app-1:
#   app dir  = /var/www/jvto-cms-bootstrap  (auto-discovered)
#   process  = pm2 app running from that dir (id 12 "jvto-cms-bootstrap", :4100)
#   there are 15 pm2 apps on this box — we must restart OURS only, never `pm2 restart all`.
#
# Optional env (workflow passes these from repo variables; all have safe defaults):
#   CMS_APP_DIR   explicit path to the checkout (else auto-discovered)
#   CMS_DEPLOY_BRANCH  branch to deploy (default: main)
#   CMS_PM2_NAME  pm2 app name to restart if cwd-match finds nothing (default jvto-cms-bootstrap)
set -euo pipefail

BRANCH="${CMS_DEPLOY_BRANCH:-main}"

# ── 1) locate the app checkout ───────────────────────────────────────────────
APP_DIR="${CMS_APP_DIR:-}"
if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR/.git" ]; then
  for base in /var/www /root /home /opt /srv /usr/share/nginx; do
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

# ── 2) capture rollback point + record any local state BEFORE touching anything ─
PREV="$(git rev-parse HEAD)"
echo "rollback: cd $APP_DIR && git reset --hard $PREV && npm ci --include=dev && npm run build && pm2 restart <app>"
DIRTY="$(git status --porcelain 2>/dev/null || true)"
if [ -n "$DIRTY" ]; then
  echo "note: working tree has local entries (preserved unless ff-forward must overwrite them):"
  echo "$DIRTY"
fi

# ── 3) fast-forward to the deployed branch (SAFE: never deletes/overwrites) ───
# ff-only preserves untracked box files (ecosystem.config.cjs, .env) and aborts cleanly
# if the box has diverging commits — no destructive reset.
if ! git ls-remote --heads origin >/dev/null 2>&1; then
  echo "ERROR: this box cannot fetch from origin (no GitHub credentials)." >&2
  exit 4
fi
git fetch --prune origin "$BRANCH"
git checkout "$BRANCH" 2>/dev/null || git checkout -B "$BRANCH" "origin/$BRANCH"
if ! git merge --ff-only "origin/$BRANCH"; then
  echo "ERROR: cannot fast-forward (box has diverging commits or a conflicting local edit)." >&2
  echo "       Inspect 'git status' on the box; do NOT force. Aborting without changes." >&2
  exit 6
fi
NEW="$(git rev-parse --short HEAD)"
echo "fast-forwarded: ${PREV:0:7} -> $NEW  ($BRANCH)"

# ── 4) install runtime + build deps, compile ─────────────────────────────────
# --include=dev because the build needs TypeScript. Node on this box is v18 and the
# repo declares engines>=22, but that is advisory (no engine-strict) so ci proceeds.
npm ci --include=dev
npm run build

# ── 5) restart ONLY the pm2 process(es) running from this checkout ───────────
# Match by pm_cwd so we touch our app and none of the other 15 on the box.
restarted=""
if command -v pm2 >/dev/null 2>&1; then
  IDS="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const dir=process.argv[1];const ids=a.filter(p=>{const c=(p.pm2_env&&p.pm2_env.pm_cwd)||"";return c===dir||c.indexOf(dir+"/")===0;}).map(p=>p.pm_id);process.stdout.write(ids.join(" "));}catch(e){}});' "$APP_DIR" 2>/dev/null || true)"
  [ -z "$IDS" ] && IDS="${CMS_PM2_NAME:-jvto-cms-bootstrap}"   # fallback to the known app name
  for t in $IDS; do
    if pm2 restart "$t" --update-env >/dev/null 2>&1; then restarted="${restarted} pm2:$t"; fi
  done
  [ -n "$restarted" ] && pm2 save >/dev/null 2>&1 || true
fi
if [ -z "$restarted" ]; then
  echo "WARN: built code is in place but no pm2 app was restarted. Set CMS_PM2_NAME." >&2
  exit 5
fi
echo "restarted:${restarted}"

# ── 6) local smoke check (from the box, whatever port our app listens on) ────
PORT="$(pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const dir=process.argv[1];const p=a.find(x=>{const c=(x.pm2_env&&x.pm2_env.pm_cwd)||"";return c===dir||c.indexOf(dir+"/")===0;});process.stdout.write(String((p&&p.pm2_env&&(p.pm2_env.PORT||p.pm2_env.env&&p.pm2_env.env.PORT))||""));}catch(e){}});' "$APP_DIR" 2>/dev/null || true)"
[ -z "$PORT" ] && PORT=4100
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/pages" 2>/dev/null || echo 000)"
echo "local smoke: GET :${PORT}/pages -> ${CODE}"
MEDIA="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/admin/media" 2>/dev/null || echo 000)"
echo "local smoke: GET :${PORT}/admin/media -> ${MEDIA}  (404 = route missing; 200/401/302 = new code live)"

echo "deploy complete: ${PREV:0:7} -> $NEW"
