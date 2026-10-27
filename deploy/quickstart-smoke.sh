#!/usr/bin/env bash
# Bring up the localhost quickstart stack, check it end to end, then tear it down.
#
#   deploy/quickstart-smoke.sh            # build, start, verify, remove (incl. volumes)
#   KEEP=1 deploy/quickstart-smoke.sh     # leave the stack running afterwards
#
# Env: PROJECT (compose project name, default stwrd-smoke), NO_HOST_PORTS=1 to drop
# the published host ports (used in CI, where the runner is shared and ports clash).
# Checks run from a curl container on the stack's own network, so they work with or
# without host ports. Needs Docker with Compose v2.24+.
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=${PROJECT:-stwrd-smoke}
export SERVER_MANAGER_EMAIL=${SERVER_MANAGER_EMAIL:-smoke@example.test}
export SERVER_MANAGER_PASSWORD=${SERVER_MANAGER_PASSWORD:-smoke-only-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')}

files=(-f docker-compose.quickstart.yml)
if [ "${NO_HOST_PORTS:-}" = 1 ]; then
  cat > .quickstart-noports.yml <<'YML'
services:
  backend: { ports: !reset [] }
  dashboard: { ports: !reset [] }
  proxy: { ports: !reset [] }
YML
  files+=(-f .quickstart-noports.yml)
fi
dc() { docker compose -p "$PROJECT" "${files[@]}" --env-file .env.quickstart "$@"; }
cleanup() {
  rc=$?
  if [ $rc -ne 0 ]; then dc ps -a || true; dc logs --no-color --tail 80 || true; fi
  if [ "${KEEP:-}" != 1 ]; then dc down -v --remove-orphans >/dev/null 2>&1 || true; rm -f .quickstart-noports.yml; fi
  exit $rc
}
trap cleanup EXIT

dc up -d --build

echo "waiting for bootstrap..."
for _ in $(seq 1 60); do
  cid=$(dc ps -a -q bootstrap)
  state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$cid" 2>/dev/null || echo "pending")
  case "$state" in "exited 0") break ;; exited*) echo "bootstrap failed: $state"; exit 1 ;; esac
  sleep 5
done
[ "$state" = "exited 0" ] || { echo "bootstrap timed out ($state)"; exit 1; }

curl_net() { docker run --rm --network "${PROJECT}_default" curlimages/curl:8.11.1 -fsS --retry 12 --retry-delay 5 --retry-all-errors "$@"; }
echo "frontend:";  curl_net -o /dev/null -w '%{http_code}\n' http://proxy/
echo "api:";       curl_net http://proxy/api/version; echo
echo "jwks:";      curl_net -o /dev/null -w '%{http_code}\n' http://proxy/.well-known/jwks.json
echo "login:"
body=$(printf '{"email":"%s","password":"%s"}' "$SERVER_MANAGER_EMAIL" "$SERVER_MANAGER_PASSWORD")
resp=$(curl_net -H 'Content-Type: application/json' -H 'Origin: http://localhost' -d "$body" http://proxy/auth/login)
echo "$resp" | grep -oE '"status":"[a-z_]+"'
echo "$resp" | grep -qE '"status":"(complete|mfa_required)"'
echo "quickstart smoke: OK"
