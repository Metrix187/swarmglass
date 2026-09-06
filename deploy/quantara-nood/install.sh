#!/usr/bin/env bash
# one-shot install on the quantara-nood box (ubuntu 24.04, docker + caddy already there).
# run as the ubuntu user from a fresh clone: bash deploy/quantara-nood/install.sh
# idempotent-ish: re-running rebuilds the image and reloads caddy.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/swarmglass}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== swarmglass install → $APP_DIR"
sudo mkdir -p "$APP_DIR" "$APP_DIR/data"
sudo rsync -a --delete --exclude .git --exclude node_modules --exclude data --exclude reports --exclude exports "$REPO_DIR/" "$APP_DIR/"
sudo chown -R "$USER":"$USER" "$APP_DIR"

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  SECRET=$(openssl rand -hex 32)
  SYNTH=$(openssl rand -hex 16)
  sed -i "s|^SWARMGLASS_SECRET_KEY=.*|SWARMGLASS_SECRET_KEY=$SECRET|" "$APP_DIR/.env"
  sed -i "s|^SWARMGLASS_SYNTH_TOKEN=.*|SWARMGLASS_SYNTH_TOKEN=$SYNTH|" "$APP_DIR/.env"
  sed -i "s|^SWARMGLASS_ENV=.*|SWARMGLASS_ENV=production|" "$APP_DIR/.env"
  echo
  echo "== .env created with fresh secrets."
  echo "   now set SWARMGLASS_CONSOLE_PASSWORD_HASH: run  docker run --rm -i quantara/swarmglass:0.1.0 node --disable-warning=ExperimentalWarning tools/hash-password.ts --stdin <<< 'your-long-password'"
  echo "   and SWARMGLASS_CONTACT_EMAIL, then re-run this script."
fi

# the data dir is owned by the container's unprivileged user (uid 100 on alpine's adduser -S)
sudo chown -R 100:101 "$APP_DIR/data" || true

cd "$APP_DIR"
docker compose build --pull
docker compose up -d

# caddy: append the option A blocks if they are not there yet
if ! grep -q "swarmglass.quantara.cv" /etc/caddy/Caddyfile; then
  echo "== adding caddy blocks (backup at /etc/caddy/Caddyfile.pre-swarmglass)"
  sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-swarmglass
  { echo; echo "# ---- swarmglass (quantara research) ----"; cat "$APP_DIR/deploy/caddy/Caddyfile.optionA"; } | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  echo "   !! edit /etc/caddy/Caddyfile: replace the TODO basic_auth hash (caddy hash-password) and the allowlist ranges"
fi
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy

echo
echo "== done. checks:"
echo "   curl -s http://127.0.0.1:8080/api/v1/status"
echo "   curl -sI https://swarmglass.quantara.cv/wiki/Main_Page   (after DNS: swarmglass A → this box)"
echo "   docker compose logs -f"
