#!/bin/sh
# Writes runtime-config.json from the environment before the server starts (spec §19.5).
# The client fetches this file before opening the Convex connection, so the public
# hostname is never baked into the image — a domain change needs only a restart.
#
#   apiUrl  — Convex client API (WebSocket + HTTP)  → SITE_ORIGIN/api
#   siteUrl — Convex HTTP actions (auth, JWKS)       → SITE_ORIGIN
#
# SITE_ORIGIN is the single required input. The legacy PUBLIC_API_ORIGIN and
# PUBLIC_CONVEX_SITE_ORIGIN are still accepted as explicit overrides for
# advanced split-origin deployments.
set -e

: "${SITE_ORIGIN:?SITE_ORIGIN is required (e.g. https://library.example.org or http://localhost)}"

API_URL="${PUBLIC_API_ORIGIN:-${SITE_ORIGIN}/api}"
SITE_URL="${PUBLIC_CONVEX_SITE_ORIGIN:-${SITE_ORIGIN}}"

CONFIG_PATH="/app/dist/client/runtime-config.json"
cat > "$CONFIG_PATH" <<EOF
{
  "apiUrl": "${API_URL}",
  "siteUrl": "${SITE_URL}"
}
EOF
echo "wrote $CONFIG_PATH (apiUrl=${API_URL}, siteUrl=${SITE_URL})"

exec "$@"
