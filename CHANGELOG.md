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

### deployed 2026-09-06

- Live on quantara-nood: `swarmglass.quantara.cv` (mirror) and `research.swarmglass.quantara.cv` (console, edge basic-auth + app login), DNS-only records in Cloudflare, Let's Encrypt via Caddy.
- quantara.cv: `/projects/swarmglass/`, the tools-index row, and the `/swarmglass/` redirect stub are live.
- Validation against the live stack: all nine personas classified as designed; a cross-session canary transfer recorded.

### heuristics v2 — 2026-09-06

The first real GPTBot crawl (382 requests, two-second beat, cookie returned, two favicon hits) scored `human_browser` at 0.28. Every rule that let that happen was proportion-blind. Changes, all in `config/heuristics.json`:

- **human_browser**: `assets` needs `asset_share >= 0.2`; `dwell` needs irregular gaps (`pacing_regularity < 0.6`); new negatives `many_pages_no_assets`, `metronome`, `declared_nonhuman` (search / ai_crawler / ai_fetcher / seo / social / monitor / headless categories, weighted like the library list), `nothing_rendered`.
- **search_bot**: `assets` by share; new `declared_ai_crawler` (+1.0, same weight class as `declared_search`).
- **naive_crawler**: new `declared_crawler_ua` (+0.8) so a self-declared crawler lands in a crawler class, with behaviour still choosing which.
- **aggressive_crawler**: `rps` and `sub100` ignore browser asset bursts; new `blast` (fifty-plus requests in a second).
- **scripted_agent**: new `probe` for scanners that never render a page.
- **retrieval_agent**: `alternates` needs `alt_share >= 0.1`; `ai_ua` now lists only the `*-User` fetchers; new `sweep` (-2 at 25+ unique pages).
- **tool_discovery_agent**: new `blanket` (-1.5 at 25+ unique pages).
- **unknown**: new `malformed_only`.
- New feature `ua_category`; the `chatgpt-user`, `claude-user`, `perplexity-user`, `meta-fetcher` families were split from their vendors' crawlers, and `mistral` is an `ai_fetcher`. `google-agent` (Gemini's `GoogleAgent-URLContext` fetcher) added the same evening after it turned up as `generic-bot`.
- Re-validated on a snapshot of the live database before rescoring: all nine personas keep their designed class with wider margins (browser_human 0.42 → 0.57, aggressive_crawler 0.38 → 0.83, recursive_follower 0.58 → 0.83); GPTBot's two sessions go from human_browser 0.28 to naive_crawler 0.90 and 0.93; the three 118-requests-in-half-a-second sweeps go from a 0.34 tie with tool discovery to aggressive_crawler 0.81; the `/.env` scanner moves from naive_crawler to scripted_agent; the malformed-only artefact session drops from human_browser to unknown. Four flips in 51 sessions, all intended.

### still open (operator)

- `remote_ip` allowlist on the console's Caddy block once the research networks are known.
- `SWARMGLASS_CONTACT_EMAIL` if `security.txt` should name a mailbox.
