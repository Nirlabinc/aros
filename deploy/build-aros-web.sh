#!/usr/bin/env bash
# Build (and optionally push) the AROS customer web image.
#
# Two steps: (1) build apps/web/dist on the host with the Supabase config
# exported so Vite inlines it; (2) package that dist into the runtime image.
# Building on the host (not hermetically in Docker) is required because the
# workspace has an absolute-path dependency (link:/shre-sdk) that only exists
# on build hosts.
#
# Usage:
#   deploy/build-aros-web.sh [--push] [--tag <tag>]
#
# Supabase vars are taken from, in order: the environment
# (VITE_SUPABASE_URL/ANON_KEY or unprefixed SUPABASE_URL/ANON_KEY), then the
# repo-root .env file.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
IMAGE="${AROS_IMAGE:-ghcr.io/shreai/shreai/aros}"
TAG="latest"
PUSH=0
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1 ;;
    --tag) TAG="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -f .env ]; then set -a; . ./.env; set +a; fi
export VITE_SUPABASE_URL="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
export VITE_SUPABASE_ANON_KEY="${VITE_SUPABASE_ANON_KEY:-${SUPABASE_ANON_KEY:-}}"
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_ANON_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL/SUPABASE_URL and VITE_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY" >&2
  echo "       must be set in the environment or repo-root .env before building." >&2
  exit 1
fi

echo "==> Building apps/web/dist (supabase url: ${VITE_SUPABASE_URL})"
[ -d apps/web/node_modules ] || pnpm install --frozen-lockfile 2>/dev/null || pnpm install
( cd apps/web && pnpm build )

echo "==> Verifying Supabase URL baked into the bundle"
grep -rqlE "supabase\.co" apps/web/dist/assets/*.js \
  || { echo "ERROR: built dist has no Supabase URL — aborting." >&2; exit 1; }

echo "==> Packaging image ${IMAGE}:${TAG}"
docker build -f deploy/Dockerfile.web -t "${IMAGE}:${TAG}" .

if [ "$PUSH" = "1" ]; then
  echo "==> Pushing ${IMAGE}:${TAG}"
  docker push "${IMAGE}:${TAG}"
fi
echo "Done: ${IMAGE}:${TAG}"
