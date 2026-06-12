#!/bin/sh
# Writes /runtime-config.json from the runtime environment before the server
# starts (spec §19.5). The client fetches it before opening the Convex
# connection — so the public hostname is never baked into the image.
#
#   apiUrl  ← PUBLIC_API_ORIGIN          (Convex client API)
#   siteUrl ← PUBLIC_CONVEX_SITE_ORIGIN  (Convex HTTP actions: /auth/*, well-known)
set -e

: "${PUBLIC_API_ORIGIN:?PUBLIC_API_ORIGIN is required}"
: "${PUBLIC_CONVEX_SITE_ORIGIN:?PUBLIC_CONVEX_SITE_ORIGIN is required}"

CONFIG_PATH="/app/.output/public/runtime-config.json"
cat > "$CONFIG_PATH" <<EOF
{
  "apiUrl": "${PUBLIC_API_ORIGIN}",
  "siteUrl": "${PUBLIC_CONVEX_SITE_ORIGIN}"
}
EOF
echo "wrote $CONFIG_PATH (apiUrl=${PUBLIC_API_ORIGIN}, siteUrl=${PUBLIC_CONVEX_SITE_ORIGIN})"

exec "$@"
