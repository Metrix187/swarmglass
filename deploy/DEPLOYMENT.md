# Deploying Swarmglass

Two supported shapes. **Option A is the one to use.**

| | Option A — `swarmglass.quantara.cv` | Option B — `quantara.cv/swarmglass` |
|---|---|---|
| where it runs | quantara-nood (Oracle ARM VM, Docker + Caddy) | the host that fronts quantara.cv |
| state shared with quantara.cv | none | none (only the proxy is shared) |
| feasible today | yes | **no** — the apex is a no-shell cPanel host |
| blast radius if the honeypot is compromised | one container on a box that also hosts femboys.fyi (separate container, separate data) | the proxy host of the main site |
| app config | defaults | `SWARMGLASS_BASE_PATH=/swarmglass`, `SWARMGLASS_PUBLIC_BASE_URL=https://quantara.cv` |
| switch cost | — | two env vars + the proxy block; every link is generated from the base path |

## Option A, step by step (quantara-nood)

1. **DNS**: add the two A records in cPanel's Zone Editor (`deploy/dns.md`).
2. **Copy the repo to the box** and run the installer:
   ```bash
   ssh quantara-nood
   git clone https://github.com/Metrix187/swarmglass.git ~/swarmglass   # TODO: or rsync from your machine
   bash ~/swarmglass/deploy/quantara-nood/install.sh
   ```
   The script creates `/opt/swarmglass/.env` with fresh `SWARMGLASS_SECRET_KEY` and `SWARMGLASS_SYNTH_TOKEN`, builds the image, starts the container on loopback ports 8080/8081, and appends the Caddy blocks.
3. **Set the console password** (never paste it into chat or a shell history):
   ```bash
   docker run --rm -i quantara/swarmglass:0.1.0 node --disable-warning=ExperimentalWarning tools/hash-password.ts --stdin < /dev/tty
   ```
   Put the printed `$scrypt$…` into `SWARMGLASS_CONSOLE_PASSWORD_HASH`, set `SWARMGLASS_CONTACT_EMAIL`, then `docker compose up -d` (a recreate, not a restart — restart does not re-read env_file).
4. **Edge auth for the console**: in `/etc/caddy/Caddyfile` replace the `TODO` basic_auth hash (`caddy hash-password`) and put your tailnet/VPN ranges in `remote_ip`. `caddy validate` then `systemctl reload caddy`.
5. **Check**:
   ```bash
   curl -s http://127.0.0.1:8080/api/v1/status
   curl -sI https://swarmglass.quantara.cv/robots.txt
   docker compose -f /opt/swarmglass/docker-compose.yml logs --tail 50
   ```
6. **Validate the pipeline** with synthetic traffic from your own machine (the token is in the server's `.env`):
   ```bash
   npm run synth -- --base https://swarmglass.quantara.cv --token <SWARMGLASS_SYNTH_TOKEN> --personas all
   ```
   Then open `https://research.swarmglass.quantara.cv` → synthetic and check the confusion matrix. Synthetic sessions never mix with real ones.

## As deployed (2026-09-06)

Live. `swarmglass.quantara.cv` and `research.swarmglass.quantara.cv` are DNS-only A records **in Cloudflare** (the zone moved there; the cPanel copy is inert, see `dns.md`), both pointing at quantara-nood. Let's Encrypt certificates via Caddy; the container runs from `/opt/swarmglass` with `data/` on the host.

| where | what |
|---|---|
| `/opt/swarmglass/.env` | production config; the scrypt hash is single-quoted (compose interpolates `$` otherwise) |
| `/opt/swarmglass/.secrets.txt` (mode 600) | edge password, console password, synth token — read it over ssh, it is never printed anywhere |
| `/etc/caddy/Caddyfile` | the two site blocks from `caddy/Caddyfile.optionA`; backup next to it as `Caddyfile.pre-swarmglass-<stamp>` |
| `/opt/swarmglass/data/` | sqlite + app logs, owned by the container user (100:101) |

Opening the console: `https://research.swarmglass.quantara.cv` asks for the **edge** basic-auth first (user `researcher`, edge password), then the app's own login (user `researcher`, console password). Both in `.secrets.txt`.

Still open on the hardening list: a `remote_ip` allowlist on the console block once the research networks are known (the commented block in `Caddyfile.optionA`), and `SWARMGLASS_CONTACT_EMAIL` if you want a mailbox in `security.txt` instead of the project page.

Things that bit during the first deploy, now baked into `install.sh`: `caddy hash-password` needs `--plaintext` when there is no terminal; an access-log `output file` block passes `caddy validate` but fails the reload, so there is none; compose's env-file interpolation eats an unquoted `$scrypt$…` hash.

## What the container can and cannot do

- Runs as an unprivileged user, read-only root filesystem, all capabilities dropped, `no-new-privileges`, memory and pid limits. The only writable path is `/data` (SQLite + logs).
- Makes **no outbound connections**. There is no code path that fetches a URL supplied by a visitor. `SWARMGLASS_TRUSTED_PROXIES` defaults cover Docker's bridge ranges so `X-Forwarded-For` from Caddy is honoured and from anyone else ignored.
- Has no access to the host filesystem, the femboys.fyi container, cPanel tokens, GitHub tokens, SSH keys, or anything on the cPanel host. The two systems share a DNS zone and nothing else.
- Serves the research console on a second port. Exposing that port to the internet without the proxy allowlist is the one configuration mistake that matters; the compose file binds it to loopback.

## Operations

| task | command |
|---|---|
| logs | `docker compose logs -f` (json lines; app also rotates its own under `/data/logs`) |
| upgrade | `git pull && docker compose build --pull && docker compose up -d` |
| backup | `sqlite3 data/swarmglass.db ".backup data/backup-$(date +%F).db"` (or copy the file while the app is stopped) |
| retention purge now | `docker compose exec swarmglass node --disable-warning=ExperimentalWarning tools/purge.ts --vacuum` |
| rescore after editing heuristics | `docker compose exec swarmglass node --disable-warning=ExperimentalWarning tools/rescore.ts` |
| report | `docker compose exec swarmglass node --disable-warning=ExperimentalWarning tools/report.ts --experiment SGX-001 --range 30d` → `/data/../reports` inside the container is read-only; use `--out /data/reports` |
| health | `GET /api/v1/status` on 8080 (public, also the Docker healthcheck); `GET /healthz` on 8081 |
| disk | the disk guard degrades writes at 90% of `SWARMGLASS_MAX_DB_MB` and purges the oldest 10% of events at 100%; the console's settings page shows the state |

## Rollback

`docker compose down` removes the container; `data/` survives. Removing the two Caddy blocks and the two A records returns the world to exactly how it was. Nothing on the cPanel host changes except the static overview page you chose to add.

## Bare metal

`deploy/systemd/swarmglass.service` runs the same thing without Docker (Node ≥ 22.18 on the host). Same hardening ideas via systemd sandboxing; note `IPAddressDeny=any` blocks egress at the unit level.
