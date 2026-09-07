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

### fixed 2026-09-06 (first evening of real traffic)

- console: motifs view returned 500. The n-gram query used a double-quoted SQL literal, which the sqlite build inside node treats as a column name.
- console: settings view crashed on render. The DOM helper flattened nested child arrays one level deep; it now flattens fully (motifs had the same shape waiting).
- console: live view never polled. It checked for its own presence in the document before the router had attached it.
- installer: readiness probe hits the console `/healthz` instead of the public status route, which was being recorded as a visitor from the docker gateway.
- sessions survive restarts and LRU eviction: a valid cookie, or a cookieless actor still inside the idle window, rehydrates the open session from the database (counters, page set, canary exposures, channels fetched, last page) instead of starting a new one. Every deploy tonight had split the GPTBot crawl in two.

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

### fixed 2026-09-06 (later the same evening)

- console: live rows were off by one column. The time and method were bare text nodes, which CSS grid folds into a single cell, so the path sat in the 40px status slot with the session link painted over it. Every cell is a span now.
- console: the live view ignored the traffic filter; with "real only" selected it still showed synthetic rows, dimmed. It filters client-side now and the hint says what it's showing. Initial tail is the full 200 the hint promised, and the dedupe set stops growing once it passes a thousand keys.
- console: query strings are shown next to the path in live rows and story steps. Nothing in the console rendered them before, so a crawler walking `?oldid=` history read as one bot hammering one page.
- console: `fmtRel` / `fmtDuration` rounded the seconds remainder on its own and printed `3m60s`; whole seconds are rounded first now.
- story: the summary's "distinct pages" counted redirect aliases and disagreed with the facts card beside it; both use the same page-kind filter now. "reached N hidden pages" was a request count and now names distinct pages, with the request count in brackets when they differ. "a obscure page" gets its article.

### heuristics v3 — 2026-09-06

An MJ12bot crawl (242 requests, 236 with a query string) walked the `?oldid=` / `?diff=` / `?action=` links the mirror emits on every page and scored `looping` 0.90 and `revisitation` 0.80 for never fetching the same url twice; the story view called all 236 of them revisits. The class still came out `search_bot`, but the evidence was wrong about what it saw, and the `scripted_agent` `query` rule was giving crawlers points for following our own links. Changes:

- `revisit_rate` and `loop_score` key on page id + query string, so a history walk is not a revisit and a real loop still is.
- New features `variant_fetches` / `variant_share` (page requests whose query keys are all ones the site emits: `action`, `oldid`, `diff`, `section`, `printable`, `redirect`, `returnto`, `namespace`, `page`, `search`, `q`, `fulltext`), `query_foreign` (requests carrying any other key), `hidden_pages` (distinct hidden pages, alongside the `hidden_hits` request count). Helper in `src/telemetry/query.ts`.
- **scripted_agent**: `query` now needs `query_foreign >= 2`.
- **search_bot**, **naive_crawler**: new `history_walk` (+0.8 at ten or more variant fetches making up 30%+ of page requests; a person clicking a few history links stays under it).
- **curiosity**: `history_walk` (+0.15).
- Story steps say what a variant asked for ("old revision 4102 of Worker_Node_Registry", "diff 4111 against 4110", "edit view (section 3)") and flag query keys the site never emits. Run `npm run rescore` after deploying; the nine synthetic personas keep their designed classes.

### still open (operator)

- `remote_ip` allowlist on the console's Caddy block once the research networks are known.
- `SWARMGLASS_CONTACT_EMAIL` if `security.txt` should name a mailbox.
