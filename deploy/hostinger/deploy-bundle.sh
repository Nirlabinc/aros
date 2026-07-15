#!/usr/bin/env bash
# Deploy a committed AROS snapshot delivered as a git bundle.
# This path deliberately has no GitHub/GitHub Actions dependency.

set -Eeuo pipefail

BUNDLE_PATH="${1:?Usage: deploy-bundle.sh <bundle-path> [git-ref]}"
BUNDLE_REF="${2:-HEAD}"
APP_DIR="${AROS_APP_DIR:-/opt/aros-platform}"
PM2_APP="${AROS_PM2_APP:-aros-platform}"
HEALTH_URL="${AROS_HEALTH_URL:-http://127.0.0.1:5457/health}"
READY_URL="${AROS_READY_URL:-http://127.0.0.1:5457/readyz}"
DEPLOY_BRANCH="live/direct-deploy"

cd "$APP_DIR"
test -f .env || { echo "Missing $APP_DIR/.env" >&2; exit 1; }
test -f "$BUNDLE_PATH" || { echo "Missing bundle: $BUNDLE_PATH" >&2; exit 1; }
pm2 describe "$PM2_APP" >/dev/null 2>&1 || { echo "Missing PM2 app: $PM2_APP" >&2; exit 1; }

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
RESTARTED=0

rollback() {
  local exit_code=$?
  trap - ERR
  echo "Deploy failed; restoring ${PREVIOUS_COMMIT:0:12}" >&2
  git checkout -B "$DEPLOY_BRANCH" "$PREVIOUS_COMMIT"
  CI=1 pnpm install --frozen-lockfile --offline --reporter=append-only
  CI=1 pnpm build
  if [[ "$RESTARTED" == "1" ]]; then
    pm2 restart "$PM2_APP" --update-env
    pm2 save
  fi
  exit "$exit_code"
}
trap rollback ERR

git fetch "$BUNDLE_PATH" "$BUNDLE_REF"
git checkout -B "$DEPLOY_BRANCH" FETCH_HEAD

set -a
source ./.env
set +a
TARGET_ENV=prod \
RUNTIME_REPO=aros \
PUBLIC_URL="${AROS_PUBLIC_URL:-https://aros.live}" \
node deploy/scripts/validate-runtime-ownership.mjs

if ! CI=1 pnpm install --frozen-lockfile --offline --reporter=append-only; then
  CI=1 pnpm install --frozen-lockfile --reporter=append-only
fi
CI=1 pnpm build

# Migrations must pass before the process is restarted.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260715_setup_resources.sql

pm2 restart "$PM2_APP" --update-env
RESTARTED=1

for _ in {1..15}; do
  if curl -fsS --max-time 10 "$HEALTH_URL" >/dev/null && \
     curl -fsS --max-time 10 "$READY_URL" >/dev/null; then
    pm2 save
    trap - ERR
    echo "Direct deploy complete: $(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 2
done

echo "Health gate failed" >&2
false
