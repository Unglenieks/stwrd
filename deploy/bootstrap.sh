#!/bin/sh
# Stwrd one-shot bootstrap — runs once after the backend is healthy.
# Every step is idempotent; re-running on an already-provisioned instance is safe.
#
# Required env: INSTANCE_NAME, INSTANCE_SECRET, SITE_ORIGIN
# Optional env: ORG_NAME, SERVER_MANAGER_EMAIL, SERVER_MANAGER_PASSWORD
set -e

: "${INSTANCE_NAME:?INSTANCE_NAME is required}"
: "${INSTANCE_SECRET:?INSTANCE_SECRET is required}"
: "${SITE_ORIGIN:?SITE_ORIGIN is required}"

BACKEND_URL="http://backend:3210"

echo ""
echo "============================================================"
echo "  Stwrd Bootstrap"
echo "============================================================"

# ── 1. Derive admin key ───────────────────────────────────────────────────────
ADMIN_KEY=$(/usr/local/bin/generate_key "$INSTANCE_NAME" "$INSTANCE_SECRET")
export CONVEX_SELF_HOSTED_URL="$BACKEND_URL"
export CONVEX_SELF_HOSTED_ADMIN_KEY="$ADMIN_KEY"

# ── 2. Deploy Convex functions & schema ──────────────────────────────────────
echo "[bootstrap] Deploying Convex functions..."
cd /repo && npx convex deploy --admin-key "$ADMIN_KEY" --url "$BACKEND_URL"

# ── 3. Idempotency check ─────────────────────────────────────────────────────
if ! ENV_LIST=$(npx convex env list --admin-key "$ADMIN_KEY" --url "$BACKEND_URL" 2>/dev/null); then
  echo "[bootstrap] Failed to query env state; aborting to avoid accidental key rotation." >&2
  exit 1
fi
PROVISIONED=$(printf '%s\n' "$ENV_LIST" | grep "^JWT_PRIVATE_KEY=" || true)
if [ -n "$PROVISIONED" ]; then
  echo "[bootstrap] Instance already provisioned — nothing to do."
  [ -f /secrets/server-manager-credentials.txt ] && cat /secrets/server-manager-credentials.txt
  exit 0
fi

# ── 4. Generate and set secrets ──────────────────────────────────────────────
echo "[bootstrap] Generating secrets..."

npx convex env set APP_SECRETS_KEY "$(openssl rand -base64 32)" \
  --admin-key "$ADMIN_KEY" --url "$BACKEND_URL"

node /repo/generate-jwt-keys.mjs > /tmp/jwt-keys.json
node -e "const d=require('/tmp/jwt-keys.json'); process.stdout.write(d.JWT_PRIVATE_KEY)" \
  > /tmp/jwt-private-key.txt
node -e "const d=require('/tmp/jwt-keys.json'); process.stdout.write(d.JWKS)" \
  > /tmp/jwks.txt

npx convex env set JWT_PRIVATE_KEY --from-file /tmp/jwt-private-key.txt \
  --admin-key "$ADMIN_KEY" --url "$BACKEND_URL"
npx convex env set JWKS --from-file /tmp/jwks.txt \
  --admin-key "$ADMIN_KEY" --url "$BACKEND_URL"

# SITE_URL is used by the auth HTTP actions for CORS (see convex/http.ts).
npx convex env set SITE_URL "$SITE_ORIGIN" \
  --admin-key "$ADMIN_KEY" --url "$BACKEND_URL"

# ── 5. Resolve server-manager credentials ────────────────────────────────────
SM_EMAIL="${SERVER_MANAGER_EMAIL:-}"
if [ -z "$SM_EMAIL" ]; then
  # Strip scheme and path, keep just the hostname for admin@<host>
  SM_HOST=$(printf '%s' "$SITE_ORIGIN" | sed 's|https\?://||' | cut -d/ -f1 | cut -d: -f1)
  SM_EMAIL="admin@${SM_HOST}"
fi

PASSWORD_WAS_GENERATED=false
SM_PASSWORD="${SERVER_MANAGER_PASSWORD:-}"
if [ -z "$SM_PASSWORD" ]; then
  PASSWORD_WAS_GENERATED=true
  # 20-char random password meeting the 8-char minimum with mixed chars.
  SM_PASSWORD="$(openssl rand -base64 24 | tr -d '+/=\n' | cut -c1-18)1!"
fi

ORG_NAME="${ORG_NAME:-My Library}"

# ── 6. Run setup wizard ───────────────────────────────────────────────────────
echo "[bootstrap] Running setup wizard..."
ADMIN_KEY="$ADMIN_KEY" BACKEND_URL="$BACKEND_URL" \
  SM_EMAIL="$SM_EMAIL" SM_PASSWORD="$SM_PASSWORD" ORG_NAME="$ORG_NAME" \
  node /repo/bootstrap-setup.mjs

# ── 7. Write credentials ──────────────────────────────────────────────────────
mkdir -p /secrets
umask 077

if [ "$PASSWORD_WAS_GENERATED" = "true" ]; then
  RESET_NOTE="
  ⚠  Password was auto-generated. Log in and reset it immediately.
     Admin → Account settings → Change password
     See docs/first-run.md for the full post-install checklist."
else
  RESET_NOTE=""
fi

cat > /secrets/server-manager-credentials.txt << EOF

  ============================================================
    Stwrd — Server Manager Credentials
  ============================================================
    URL:      ${SITE_ORIGIN}
    Email:    ${SM_EMAIL}
    Password: ${SM_PASSWORD}
  ${RESET_NOTE}
  ============================================================
    Admin key (keep this safe — needed for backups/upgrades):
    ${ADMIN_KEY}
  ============================================================

EOF

echo ""
cat /secrets/server-manager-credentials.txt
echo "[bootstrap] Credentials also saved to deploy/secrets/server-manager-credentials.txt"
echo "[bootstrap] Done."
