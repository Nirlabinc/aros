#!/usr/bin/env bash
# Shre Production VPS — Full Stack Deployment
# Deploys: AROS (PM2) + Shre Core (Docker)
#
# Usage:
#   ./deploy-full.sh                    # Deploy everything
#   ./deploy-full.sh --aros-only        # AROS only (PM2)
#   ./deploy-full.sh --docker-only      # Docker stacks only
#
# Prereqs on VPS:
#   - Docker + Docker Compose v2
#   - Node 20+, pnpm, pm2 (for AROS)
#   - nginx + certbot
#   - /opt/shre/ directory structure
#   - /opt/shre/envs/.env.shre-core
#
# NOTE: SpillQuest (spillquest.com) is a separate product deployed from its own
# repo (Nirpat3/find-myself) onto its own dedicated VPS — it is intentionally
# not managed here.

set -euo pipefail

DEPLOY_DIR="/opt/shre"
AROS_DIR="/opt/aros-platform"
COMPOSE_DIR="$DEPLOY_DIR/compose"
ENV_DIR="$DEPLOY_DIR/envs"

MODE="${1:-all}"

echo "═══════════════════════════════════════════"
echo "  Shre Production VPS Deploy"
echo "  Mode: $MODE"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════"

# ── Pre-flight checks ──────────────────────────────────────────────────────

preflight() {
  echo "Pre-flight checks..."

  # Docker
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker not running"
    exit 1
  fi

  # Env files
  for envfile in "$ENV_DIR/.env.shre-core"; do
    if [ ! -f "$envfile" ]; then
      echo "ERROR: Missing $envfile"
      exit 1
    fi
  done

  # Disk space (need at least 2GB free)
  FREE_KB=$(df /opt | tail -1 | awk '{print $4}')
  if [ "$FREE_KB" -lt 2097152 ]; then
    echo "WARNING: Less than 2GB free on /opt"
  fi

  echo "Pre-flight OK"
}

# ── AROS (PM2) ─────────────────────────────────────────────────────────────

deploy_aros() {
  echo ""
  echo "── Deploying AROS (PM2) ──"

  if [ -d "$AROS_DIR/.git" ]; then
    cd "$AROS_DIR"
    git fetch origin
    git reset --hard origin/main
  else
    echo "ERROR: $AROS_DIR not initialized. Run deploy.sh first."
    return 1
  fi

  pnpm install --frozen-lockfile
  pnpm build

  pm2 startOrRestart deploy/hostinger/ecosystem.config.cjs --env production
  pm2 save

  echo "AROS: $(curl -sf http://localhost:5457/health 2>/dev/null && echo 'OK' || echo 'STARTING...')"
}

# ── Shre Core (Docker Compose) ─────────────────────────────────────────────

deploy_shre_core() {
  echo ""
  echo "── Deploying Shre Core Services (Docker) ──"

  cd "$COMPOSE_DIR"

  # Symlink env file
  ln -sf "$ENV_DIR/.env.shre-core" .env.aros-retail

  docker compose -f docker-compose.aros-retail.yml pull --quiet 2>/dev/null || true
  docker compose -f docker-compose.aros-retail.yml up -d --remove-orphans

  echo "Waiting for core services..."
  sleep 10

  for svc in 5431 5455 5497 5438 5460; do
    status=$(curl -sf "http://localhost:$svc/health" 2>/dev/null && echo "OK" || echo "STARTING")
    echo "  :$svc $status"
  done
}

# ── Nginx config sync ──────────────────────────────────────────────────────

sync_nginx() {
  echo ""
  echo "── Syncing nginx configs ──"

  NGINX_SRC="$COMPOSE_DIR/nginx"
  NGINX_DST="/etc/nginx/sites-available"

  for conf in aros nirtek; do
    if [ -f "$NGINX_SRC/$conf.conf" ]; then
      cp "$NGINX_SRC/$conf.conf" "$NGINX_DST/$conf"
      ln -sf "$NGINX_DST/$conf" "/etc/nginx/sites-enabled/$conf" 2>/dev/null || true
      echo "  $conf.conf -> $NGINX_DST/$conf"
    fi
  done

  nginx -t && systemctl reload nginx
  echo "  nginx reloaded"
}

# ── Main ───────────────────────────────────────────────────────────────────

preflight

case "$MODE" in
  --aros-only)
    deploy_aros
    ;;
  --docker-only)
    deploy_shre_core
    ;;
  all|*)
    deploy_aros
    deploy_shre_core
    sync_nginx
    ;;
esac

echo ""
echo "═══════════════════════════════════════════"
echo "  Deploy complete: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "═══════════════════════════════════════════"
