# Changelog

All notable changes. Experiment activations, seed bumps and heuristics bumps are logged here with dates because they change what the numbers mean.

## 0.1.0 — 2026-09-05 (research release SGR-2026.09)

First complete build.

- **mirror**: 62 fictional pages, 14 attachments, monobook-era skin, fifteen discoverability classes, redirects, aliases, 410s, stale index, archive box, specials (AllPages, Categories, RecentChanges, Random, Search, WhatLinksHere, Export, Statistics, Version, Log, ListUsers, UserLogin), history/source/info actions, json/txt/yaml alternates by suffix and by `Accept`, legacy `index.php` urls.
- **channels**: robots.txt (+ archive sitemap named only in a comment), sitemap.xml, sitemap-archive.xml, atom, rss, opensearch, humans.txt, security.txt, llms.txt, `.well-known/antfarm-tools.json`, `.well-known/ai-plugin.json`, OpenAPI 3, read API (`/api/v1/*`), MediaWiki-style `api.php`, `Link:` headers, JSON-LD, OpenGraph `see_also`.
- **canaries**: `QUANTARA-SWARMGLASS-<scope><n>-<hex>` in visible / comment / meta / json-ld / header / feed / api / attachment / text / json / yaml / manifest / sitemap / robots placements; route- and session-scoped; sightings scanned in path, query, referer, ua, headers, cookies, bounded bodies; cross-session and cross-actor attribution; external sightings.
- **telemetry**: sessions (cookie → actor fingerprint of prefix + user-agent → new), events, discoveries with attribution, navigation edges, exposures, sightings, clusters, daily rollups. Truncated + daily-salted addresses, header allowlist, no bodies, 90-day retention, disk guard, log rotation.
- **heuristics v1**: 14 traits, 8 classes, ~90 legible rules with evidence.
- **experiments**: SGX-000 … SGX-010 defined; **active from 2026-09-05**: SGX-001 discovery-channel, SGX-002 structured-data, SGX-003 title-style, SGX-005 link-depth, SGX-007 representation, SGX-008 deprecation-flag, SGX-010 doc-language. Paused: SGX-004, SGX-006, SGX-009 (global scope, one at a time).
- **console**: overview, live, sessions, story view, cohorts, pages, canaries, experiments, motifs, anomalies, synthetic, settings; scrypt login, csrf, ip allowlist, audit log; sanitized exports and bundles.
- **synthetic**: nine personas, tagged runs, confusion matrix.
- **publishing**: report generator (md/json/csv/svg), dataset export with checksums, bundle, article converter for the quantara.cv template.
- **deploy**: Dockerfile (node:24-alpine, non-root, read-only), compose with hardening, Caddy option A/B, nginx, traefik, systemd, quantara-nood installer, DNS and Cloudflare notes.
- **quantara.cv**: `/projects/swarmglass/` overview page, `/swarmglass/` redirect stub, homepage row, sitemap entries (staged in the site repo, not yet pushed).
- **seed 2026.09.0**.

### known TODOs (operator)

- `SWARMGLASS_CONSOLE_PASSWORD_HASH`, `SWARMGLASS_CONTACT_EMAIL` in the server `.env`.
- Caddy `basic_auth` hash and `remote_ip` ranges for the console.
- Two A records in cPanel's Zone Editor.
- Push the quantara.cv pages with `deploy/push.py`.
