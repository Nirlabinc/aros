#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f /opt/aros-platform/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/aros-platform/.env
  set +a
fi

export PORT="${PORT:-5457}"
export NODE_ENV="${NODE_ENV:-production}"

exec npm run serve
