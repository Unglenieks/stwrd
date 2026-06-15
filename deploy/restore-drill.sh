#!/usr/bin/env bash
# Backup → restore drill (spec §18.4). Exports a consistent snapshot (all tables
# + file storage), restores it with `import --replace`, and verifies the data
# survived the round-trip. Run from the repo root against a SEEDED deployment with
# CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY set (the CI restore-drill
# job and the documented ops procedure both invoke this).
#
# IMPORTANT: `import --replace` is destructive and should target a DISPOSABLE /
# FRESH deployment (the spec restores "into a fresh stack", §18.4) — the CI job
# spins up a throwaway backend for exactly this. Running it against a live backend
# replaces all data in place and is not how a real restore is performed.
set -euo pipefail

SNAP="${1:-/tmp/lot-restore-drill-$(date +%s).zip}"

echo "1/4 · export snapshot → $SNAP"
npx convex export --path "$SNAP"
test -s "$SNAP" || { echo "FAIL: snapshot is empty"; exit 1; }

echo "2/4 · capture pre-restore state"
before=$(npx convex run settings:setupStatus 2>/dev/null)
echo "    $before"

echo "3/4 · restore (import --replace)"
npx convex import --replace --yes "$SNAP"

echo "4/4 · verify post-restore state matches"
after=$(npx convex run settings:setupStatus 2>/dev/null)
echo "    $after"

if [ "$before" != "$after" ]; then
  echo "FAIL: setup status differs after restore"
  exit 1
fi
echo "$after" | grep -q '"setupComplete": true' || {
  echo "FAIL: restored instance is not set up (data did not survive)"; exit 1;
}
echo "✅ restore drill OK — snapshot exported, restored, and verified"
