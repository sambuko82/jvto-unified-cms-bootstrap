#!/usr/bin/env bash
# remote-inspect.sh — READ-ONLY discovery of the CMS app on the production host.
# Runs over SSH from the deploy workflow. Changes NOTHING: no git writes, no npm,
# no restart. Its whole job is to answer the questions that let us write a correct,
# non-guessing deploy: where the app lives, how it gets DATABASE_URL, whether the
# box can fetch from GitHub, and what restarts it (pm2 vs systemd).
#
# Optional env (passed by the workflow from repo variables): CMS_APP_DIR.
set -uo pipefail

line() { printf '\n== %s ==\n' "$1"; }

line "identity"
whoami 2>/dev/null; hostname 2>/dev/null; uname -a 2>/dev/null

line "node / npm / pm2"
command -v node >/dev/null 2>&1 && echo "node $(node -v)" || echo "node: NOT FOUND"
command -v npm  >/dev/null 2>&1 && echo "npm  $(npm -v)"  || echo "npm: NOT FOUND"
if command -v pm2 >/dev/null 2>&1; then echo "pm2 present:"; pm2 list 2>/dev/null; else echo "pm2: NOT FOUND"; fi

line "systemd services mentioning cms/node/jvto"
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-units --type=service --all --no-pager 2>/dev/null \
    | grep -iE 'cms|node|jvto|fastify' || echo "(none matched)"
else
  echo "systemctl: NOT FOUND"
fi

line "locate the app checkout (git remote points at this repo)"
FOUND=""
if [ -n "${CMS_APP_DIR:-}" ] && [ -d "${CMS_APP_DIR}/.git" ]; then
  echo "configured CMS_APP_DIR=$CMS_APP_DIR"; FOUND="$CMS_APP_DIR"
fi
for base in /root /var/www /home /opt /srv /usr/share/nginx; do
  [ -d "$base" ] || continue
  while IFS= read -r gitdir; do
    d="$(dirname "$gitdir")"
    url="$(git -C "$d" config --get remote.origin.url 2>/dev/null || true)"
    case "$url" in
      *jvto-unified-cms-bootstrap*|*jvto-unified-cms*)
        br="$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
        sha="$(git -C "$d" rev-parse --short HEAD 2>/dev/null || echo '?')"
        dirty="$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
        echo "FOUND app: $d"
        echo "  remote=$url"
        echo "  branch=$br  commit=$sha  uncommitted_files=$dirty"
        [ -z "$FOUND" ] && FOUND="$d"
        ;;
    esac
  done < <(find "$base" -maxdepth 4 -type d -name .git 2>/dev/null)
done
[ -z "$FOUND" ] && echo "(!) no checkout of this repo found under the common roots — set CMS_APP_DIR"

line "how the app gets its config (DATABASE_URL / PORT) — presence only, values redacted"
if [ -n "$FOUND" ]; then
  for f in "$FOUND/.env" "$FOUND/.env.production" "$FOUND/.env.local"; do
    [ -f "$f" ] && echo "env file present: $f  (keys: $(grep -oE '^[A-Z_]+' "$f" 2>/dev/null | paste -sd, -))"
  done
  ls -la "$FOUND" 2>/dev/null | grep -iE '\.env|ecosystem|pm2' || true
fi
# pm2 ecosystem or service env often carry DATABASE_URL instead of a file
[ -f /etc/systemd/system/*.service ] 2>/dev/null && grep -ilE 'DATABASE_URL' /etc/systemd/system/*.service 2>/dev/null || true

line "can THIS box fetch from GitHub? (decides git-pull vs rsync-from-runner)"
if [ -n "$FOUND" ]; then
  if git -C "$FOUND" ls-remote --heads origin >/dev/null 2>&1; then
    echo "git fetch WORKS from the box (credentials/deploy-key present) -> git-pull deploy is viable"
  else
    echo "git fetch FAILS from the box (no creds) -> deploy must rsync built code from the runner"
  fi
fi

line "what is listening (which port the reverse proxy targets)"
( ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null ) | grep -iE 'node|:3000|:3001|:8080' || echo "(no obvious node listener on common ports)"

line "reverse-proxy config mapping the CMS hostname"
grep -rilsE 'jvto-cms|jvto_cms' /etc/nginx /etc/caddy /etc/apache2 /etc/httpd 2>/dev/null | head -10 || echo "(no proxy config matched)"

line "inspect complete"
echo "Use the above to finalize scripts/deploy/remote-deploy.sh (app dir, fetch method, restart command)."
