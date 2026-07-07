#!/usr/bin/env bash
# Shre Production VPS — Full Stack First-Time Setup
# Run as root: sudo bash setup-vps-full.sh
#
# Sets up: Docker + Docker Compose, Node 20, PM2, nginx, certbot,
# directory structure for AROS (PM2) + Shre Core (Docker)
#
# NOTE: SpillQuest (spillquest.com) is a separate product with its own repo
# (Nirpat3/find-myself) and its own dedicated VPS — not provisioned here.

set -euo pipefail

echo "═══════════════════════════════════════════"
echo "  Shre Production VPS — Full Stack Setup"
echo "═══════════════════════════════════════════"

# ── System packages ──────────────────────────────────────────────────────
echo "Installing system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git nginx certbot python3-certbot-nginx python3-certbot-dns-cloudflare \
  ufw build-essential rsync jq

# ── Docker + Docker Compose ──────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable docker
  systemctl start docker
fi
echo "Docker: $(docker --version)"

# Docker Compose v2 (plugin) — already included with modern Docker
if ! docker compose version &>/dev/null; then
  echo "ERROR: Docker Compose v2 not available. Install the docker-compose-plugin."
  exit 1
fi
echo "Compose: $(docker compose version)"

# ── Node.js 20 via NodeSource ────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node: $(node -v), npm: $(npm -v)"

# ── pnpm + PM2 ──────────────────────────────────────────────────────────
corepack enable
corepack prepare pnpm@9.15.4 --activate
npm install -g pm2 tsx
pm2 startup systemd -u root --hp /root
echo "pnpm: $(pnpm -v), PM2 installed"

# ── Firewall ─────────────────────────────────────────────────────────────
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "Firewall: SSH + Nginx"

# ── App user ─────────────────────────────────────────────────────────────
id -u aros &>/dev/null || useradd -m -s /bin/bash -G docker aros
echo "User: aros (in docker group)"

# ── Directory structure ──────────────────────────────────────────────────
echo "Creating directory structure..."

# AROS (PM2 — existing)
mkdir -p /opt/aros-platform
mkdir -p /var/log/aros

# Shre full stack
mkdir -p /opt/shre/compose      # Docker compose files live here
mkdir -p /opt/shre/envs         # Environment files (chmod 600)
mkdir -p /opt/shre/data         # Persistent Docker volume mount points
mkdir -p /opt/shre-sdk          # Shared SDK (git-pulled separately)
mkdir -p /var/log/shre          # Centralized logs
mkdir -p /var/www/certbot       # Certbot webroot

# Set ownership
chown -R aros:aros /opt/aros-platform /opt/shre /opt/shre-sdk /var/log/aros /var/log/shre

# Secure env directory
chmod 700 /opt/shre/envs

echo "Directories created:"
echo "  /opt/aros-platform     — AROS app (PM2)"
echo "  /opt/shre/compose      — Docker compose files"
echo "  /opt/shre/envs         — Environment files (600)"
echo "  /opt/shre/data         — Persistent data"
echo "  /opt/shre-sdk          — Shared SDK"

# ── Nginx config ─────────────────────────────────────────────────────────
echo "Configuring nginx..."

# Remove default
rm -f /etc/nginx/sites-enabled/default

# Copy configs if available
NGINX_SRC="/opt/shre/compose/nginx"
mkdir -p "$NGINX_SRC"

echo "Nginx base configured. Configs will be synced by deploy-full.sh."

# Test + reload
nginx -t && systemctl reload nginx

# ── Certbot auto-renewal ────────────────────────────────────────────────
systemctl enable certbot.timer 2>/dev/null || true

# ── Docker log rotation ────────────────────────────────────────────────
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

echo ""
echo "═══════════════════════════════════════════"
echo "  Setup Complete"
echo "═══════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Clone repos (as aros user):"
echo "   su - aros"
echo "   git clone git@github.com:Nirlabinc/aros-platform.git /opt/aros-platform"
echo "   git clone git@github.com:Nirpat3/shre-sdk.git /opt/shre-sdk"
echo "   cd /opt/shre-sdk && pnpm install && pnpm build"
echo ""
echo "2. Copy compose files:"
echo "   cp /opt/aros-platform/deploy/docker-compose.aros-retail.yml /opt/shre/compose/"
echo ""
echo "3. Create env files from templates:"
echo "   cp /opt/aros-platform/deploy/hostinger/.env.shre-core.example /opt/shre/envs/.env.shre-core"
echo "   nano /opt/shre/envs/.env.shre-core    # Fill in real values"
echo "   chmod 600 /opt/shre/envs/.env.*"
echo ""
echo "4. Copy nginx configs:"
echo "   mkdir -p /opt/shre/compose/nginx"
echo "   cp /opt/aros-platform/deploy/hostinger/nginx.conf /opt/shre/compose/nginx/aros.conf"
echo "   cp /opt/aros-platform/deploy/hostinger/nginx-nirtek.conf /opt/shre/compose/nginx/nirtek.conf"
echo ""
echo "5. SSL certificates:"
echo "   # AROS (already done if migrated earlier)"
echo "   certbot --nginx -d aros.nirtek.net --non-interactive --agree-tos --email admin@nirtek.net"
echo "   # nirtek.net wildcard (requires DNS challenge via Cloudflare)"
echo "   certbot certonly --dns-cloudflare --dns-cloudflare-credentials /root/.cloudflare.ini -d nirtek.net -d '*.nirtek.net' --agree-tos --email admin@nirtek.net"
echo ""
echo "6. Deploy:"
echo "   /opt/aros-platform/deploy/hostinger/deploy-full.sh"
