#!/usr/bin/env bash
# Local (no-CI, no-registry) deploy for the AROS customer web app.
# Run this ON the deploy host (e.g. aros-main); it builds the image from the
# checked-out source with Supabase baked in and recreates the `aros` container
# in place. No GitHub Actions and no GHCR push required.
#
#   bash deploy/deploy-aros-web.sh
#
# From your workstation:  ssh aros-main 'cd /opt/aros-platform && bash deploy/deploy-aros-web.sh'
#
# Supabase vars come from the repo-root .env (VITE_SUPABASE_*/SUPABASE_*),
# same as build-aros-web.sh.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
TAG="${AROS_TAG:-aros-web-local}"
IMAGE="${AROS_IMAGE:-ghcr.io/shreai/shreai/aros}"
NAME="${AROS_CONTAINER:-aros}"
PORT_MAP="${AROS_PORT_MAP:-3100:3000}"
ENV_FILE="${AROS_ENV_FILE:-/opt/aros/.env}"

echo "==> Building image ${IMAGE}:${TAG} (local, no push)"
bash deploy/build-aros-web.sh --tag "${TAG}"

# Resolve the runtime env file: prefer the canonical one, else snapshot the
# running container's env so we don't lose Supabase/DB settings on recreate.
TMP_ENV=""
if [ ! -f "${ENV_FILE}" ]; then
  if docker inspect "${NAME}" >/dev/null 2>&1; then
    TMP_ENV="$(mktemp)"
    docker inspect "${NAME}" --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|HOSTNAME|HOME)=' > "${TMP_ENV}"
    ENV_FILE="${TMP_ENV}"
    echo "==> Using env snapshot from running ${NAME} container"
  else
    echo "ERROR: no ${ENV_FILE} and no running ${NAME} container to copy env from." >&2
    exit 1
  fi
else
  echo "==> Using env file ${ENV_FILE}"
fi

# Recreate, keeping the previous container as a timestamped rollback backup.
if docker inspect "${NAME}" >/dev/null 2>&1; then
  BAK="${NAME}-bak-$(date +%Y%m%d-%H%M%S)"
  echo "==> Backing up current container -> ${BAK}"
  docker stop "${NAME}" >/dev/null 2>&1 || true
  docker rename "${NAME}" "${BAK}"
fi

echo "==> Starting ${NAME} from ${IMAGE}:${TAG}"
docker run -d --name "${NAME}" --restart unless-stopped \
  -p "${PORT_MAP}" --env-file "${ENV_FILE}" "${IMAGE}:${TAG}" >/dev/null
[ -n "${TMP_ENV}" ] && rm -f "${TMP_ENV}"

echo "==> Verifying"
sleep 4
PORT="${PORT_MAP%%:*}"
if curl -fsS --max-time 8 "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true'; then
  bundle=$(curl -sS --max-time 8 "http://127.0.0.1:${PORT}/" | grep -oE 'index-[A-Za-z0-9_]+\.js' | head -1)
  echo "✅ ${NAME} healthy on :${PORT} (bundle: ${bundle})"
  echo "   Old container kept as a rollback backup; remove with: docker rm \$(docker ps -aq -f name=${NAME}-bak)"
else
  echo "❌ health check failed — check 'docker logs ${NAME}'" >&2
  exit 1
fi
