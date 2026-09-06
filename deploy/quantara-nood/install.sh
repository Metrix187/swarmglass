#!/usr/bin/env bash
# install / upgrade swarmglass on quantara-nood (ubuntu 24.04 arm64, docker + caddy already there).
# run as the ubuntu user: bash ~/swarmglass/deploy/quantara-nood/install.sh
# re-runnable: pulls the code, rebuilds the image, recreates the container, keeps .env and the caddy blocks.
#
# what it does on a first run:
#   1. rsync the checkout to /opt/swarmglass (data/ and .env survive re-runs)
#   2. build the image, read the container's uid:gid, chown data/
#   3. generate every secret on this box: app secret key, synth token, console password (scrypt-hashed by the
#      app's own tool inside the image), and an edge password for caddy's basic_auth (bcrypt via caddy).
#      plaintexts land in /opt/swarmglass/.secrets.txt, mode 600, and nowhere else.
#   4. write a clean .env — the scrypt hash is single-quoted because docker compose interpolates `$` in env files
#   5. docker compose up -d, wait for the healthcheck
#   6. append the caddy blocks with the real hash, validate, reload (backup of the Caddyfile first)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/swarmglass}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
IMG="quantara/swarmglass:0.1.0"

echo "== swarmglass → $APP_DIR (from $REPO_DIR)"
sudo mkdir -p "$APP_DIR/data"
sudo rsync -a --delete --exclude .git --exclude node_modules --exclude data --exclude reports --exclude exports \
  --exclude .env --exclude .secrets.txt --exclude .edge-hash "$REPO_DIR/" "$APP_DIR/"
sudo chown -R "$USER":"$USER" "$APP_DIR"
cd "$APP_DIR"

echo "== build"
docker compose build --pull | tail -2
UIDGID=$(docker run --rm --entrypoint sh "$IMG" -c 'echo $(id -u):$(id -g)')
sudo chown -R "$UIDGID" "$APP_DIR/data"

if [ ! -f .env ]; then
  echo "== first run: generating secrets on this box"
  umask 077
  SECRET=$(openssl rand -hex 32)
  SYNTH=$(openssl rand -hex 16)
  CONSOLE_PW=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-24)
  EDGE_PW=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-24)
  HASH=$(printf '%s' "$CONSOLE_PW" | docker run --rm -i --entrypoint node "$IMG" --disable-warning=ExperimentalWarning tools/hash-password.ts --stdin)
  case "$HASH" in '$scrypt$'*) ;; *) echo "!! console hash generation failed: $HASH"; exit 1;; esac
  EDGE_HASH=$(caddy hash-password --plaintext "$EDGE_PW")
  case "$EDGE_HASH" in '$2a$'*|'$2b$'*) ;; *) echo "!! edge hash generation failed"; exit 1;; esac
  cat > .env <<EOF
SWARMGLASS_ENV=production
SWARMGLASS_PUBLIC_BASE_URL=https://swarmglass.quantara.cv
SWARMGLASS_CONSOLE_BASE_URL=https://research.swarmglass.quantara.cv
SWARMGLASS_CONSOLE_USER=researcher
SWARMGLASS_CONSOLE_PASSWORD_HASH='$HASH'
SWARMGLASS_SECRET_KEY=$SECRET
SWARMGLASS_SYNTH_TOKEN=$SYNTH
SWARMGLASS_TRUST_PROXY=true
SWARMGLASS_TRUSTED_PROXIES=127.0.0.1/32,::1/128,172.16.0.0/12,10.0.0.0/8
SWARMGLASS_PRIVACY_IP_MODE=truncate_hash
SWARMGLASS_RETENTION_DAYS=90
SWARMGLASS_LOG_LEVEL=info
SWARMGLASS_CONTACT_EMAIL=
EOF
  cat > .secrets.txt <<EOF
# swarmglass secrets, generated $(date -u +%FT%TZ) on this box. mode 600. not backed up anywhere.
console url:        https://research.swarmglass.quantara.cv
edge (caddy) user:  researcher
edge password:      $EDGE_PW
console user:       researcher
console password:   $CONSOLE_PW
synth token:        $SYNTH
EOF
  printf '%s\n' "$EDGE_HASH" > .edge-hash
  echo "   secrets written to $APP_DIR/.secrets.txt (read it over ssh; it is never printed)"
fi

echo "== start"
docker compose up -d --force-recreate 2>&1 | grep -vi "variable is not set" | tail -1
# probe the console's /healthz, never the public listener: a host-side curl arrives from the docker gateway, not
# loopback, so the app would record it as a visitor
for i in $(seq 1 12); do
  sleep 3
  if curl -sf -m 3 http://127.0.0.1:8081/healthz >/dev/null; then echo "   app answering ($i)"; break; fi
done
curl -s -m 5 -o /dev/null -w '   console healthz:  %{http_code}\n' http://127.0.0.1:8081/healthz

if ! grep -q "swarmglass.quantara.cv" /etc/caddy/Caddyfile; then
  echo "== caddy: appending site blocks (backup at /etc/caddy/Caddyfile.pre-swarmglass-<stamp>)"
  EDGE_HASH=$(cat .edge-hash)
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.pre-swarmglass-$(date +%Y%m%d%H%M%S)"
  { echo; echo "# ---- swarmglass (quantara research) ----"; sed "s|\$2a\$14\$REPLACE_WITH_CADDY_HASH_PASSWORD_OUTPUT|$EDGE_HASH|" "$APP_DIR/deploy/caddy/Caddyfile.optionA" | grep -v '^#'; } | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  if sudo caddy validate --config /etc/caddy/Caddyfile 2>&1 | tail -1 | grep -q "Valid configuration"; then
    sudo systemctl reload caddy && echo "   caddy reloaded"
  else
    echo "!! caddy validation failed; restoring the backup"; sudo cp "$(ls -t /etc/caddy/Caddyfile.pre-swarmglass-* | head -1)" /etc/caddy/Caddyfile; exit 1
  fi
else
  echo "== caddy: blocks already present, not touching the Caddyfile"
fi

echo
echo "== done. dns: two DNS-only A records in cloudflare (swarmglass, research.swarmglass) → this box; then:"
echo "   curl -sI https://swarmglass.quantara.cv/robots.txt | head -3"
echo "   docker compose -f $APP_DIR/docker-compose.yml logs -f"
