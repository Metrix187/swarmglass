# Data dictionary

Every derived quantity, in the order the pipeline produces it. Column-level storage is in `TELEMETRY_SCHEMA.md`; this file explains **features** (per session, computed from events), **traits** and **classes** (from `config/heuristics.json`), **cluster signals**, and **export fields**.

## Features (`sessions.features_json`)

Computed by `computeFeatures()` in `src/telemetry/features.ts` from the session's persisted events, so `npm run rescore` reproduces them exactly.

### volume and kinds

| feature | meaning |
|---|---|
| `n_requests` | events in the session |
| `duration_ms` | last − first event |
| `n_page` | page + special fetches |
| `n_alt` | alternate representations (json/txt/yaml/raw/export) |
| `n_api`, `n_manifest`, `n_robots`, `n_sitemap`, `n_feed`, `n_attachment`, `n_asset`, `n_missing`, `n_gone`, `n_redirect`, `n_index` | per resource kind |
| `n_machine`, `machine_share` | machine-readable fetches and their share of all requests |
| `alt_share` | alternate representations as a share of all requests |
| `asset_share` | stylesheet/script/favicon share |
| `n_head`, `n_post` | methods |
| `n_errors`, `error_rate`, `n_429`, `n_malformed` | |
| `n_disallowed` | successful fetches of robots-disallowed paths |
| `fetched_robots`, `robots_first`, `disallowed_after_robots` | robots.txt handling |
| `machine_first` | one of the first three requests was a machine channel |

### pages and traversal

| feature | meaning |
|---|---|
| `n_unique_pages`, `revisit_rate` | distinct pages; (page requests − distinct)/page requests |
| `max_depth`, `mean_depth` | link depth of pages fetched |
| `bfs_score` | 1 − (depth decreases between consecutive first discoveries)/(discoveries − 1); 0.5 when < 3 pages |
| `dive_ratio` | max depth / distinct pages |
| `deepen_rate` | share of consecutive discoveries that went deeper |
| `nav_entropy` | Shannon entropy of the page sequence, normalised by log2(n) |
| `kind_entropy` | same over resource kinds |
| `alpha_order` | share of consecutive first discoveries in alphabetical order (index iteration) |
| `reach_<class>` | count of pages fetched per discoverability class (`reach_robots_only`, `reach_orphan`, …) |
| `hidden_hits`, `hidden_share` | pages not in the `visible` class |
| `topic_coherence` | mean category Jaccard between consecutive pages |
| `manifest_hit`, `manifest_rank` | fetched a manifest/api/Tool_Registry; position of the first such fetch as a fraction of the session |
| `tool_pages` | fetches of agent/tool-themed pages |
| `redirects_hit`, `redirect_follow_rate` | 3xx responses and how many were followed within 5 s |
| `loop_score`, `repeat_max` | share of request trigrams that repeat; largest repeat count |
| `n_404_repeat` | re-requests of paths that already 404'd |

### timing

| feature | meaning |
|---|---|
| `mean_gap_ms`, `median_gap_ms`, `min_gap_ms`, `p90_gap_ms` | inter-request gaps |
| `cv_gap` | coefficient of variation of gaps |
| `pacing_regularity` | 1 − min(1, cv_gap) |
| `rps_peak` | most requests in any 1 s window |
| `concurrency` | max overlapping in-flight requests (by latency) |
| `sub_100ms_share`, `dwell_like_share` | gaps < 100 ms; gaps between 1.5 s and 2 min |

### headers and negotiation

| feature | meaning |
|---|---|
| `ua_family` | self-declared family label |
| `cookie_returned`, `cookie_present_share` | |
| `header_order_variants`, `mean_header_count` | distinct wire orders of header names |
| `has_sec_fetch`, `has_client_hints`, `has_accept_language` | browser fetch-metadata presence |
| `http2_share` | |
| `accept_html_share`, `accept_json_share`, `accept_any_share` | what `Accept` asked for |
| `negotiated_nonhtml` | responses served as non-html by negotiation |
| `internal_referer_share` | page requests carrying a same-site referer |
| `query_usage` | requests with query parameters |

### canaries

| feature | meaning |
|---|---|
| `canary_exposed`, `canary_unique_exposed` | |
| `canary_seen` | canaries found in requests |
| `canary_self_reuse` | sightings of canaries this session had been shown earlier |
| `canary_cross_session`, `canary_cross_actor` | sightings of canaries never shown to this session / actor |

## Traits (`scores_json.traits`, each 0–1 with evidence)

`automation_likelihood` (logistic), `curiosity`, `persistence`, `breadth_first`, `robots_compliance`, `metadata_preference`, `memory_reuse`, `apparent_coordination`, `looping`, `tool_manifest_attraction`, `hidden_resource_discovery`, `navigation_entropy`, `revisitation`, `cross_session_canary_reuse`. Definitions, rules and weights: `config/heuristics.json`. Each carries `evidence: [{rule, weight, note}]`.

## Classes (`scores_json.classes`, probabilities summing to 1)

`human_browser`, `search_bot`, `naive_crawler`, `aggressive_crawler`, `scripted_agent`, `retrieval_agent`, `tool_discovery_agent`, `unknown`. `likely_class` is the argmax; `confidence` is its probability minus the runner-up's. `class_evidence` lists fired rules per class.

## Cluster signals (`clusters.signals_json`)

| signal | fires when |
|---|---|
| `multi_network_same_client` | ≥ 3 network prefixes share one exact user-agent hash |
| `partitioned_coverage` | union ≥ 12 pages, mean pairwise Jaccard < 0.2, union/total > 0.7 |
| `synchronized_start` | ≥ 3 sessions began within 60 s |
| `concurrent_activity` | > 50% of member pairs overlapped in time |
| `canary_transfer` | cross-actor sightings among members |
| `shared_pacing` | median gaps agree within 25% |
| `single_actor_repeat` | one actor, ≥ 3 sessions (listed for honesty; does not count toward the score) |

`swarm_score` = min(1, Σ strength / 3). Labels: ≥ 0.6 *possible coordinated group*, ≥ 0.3 *weak coordination hints*, else *similar sessions*; one actor → *repeat visitor*.

## Export fields (public level)

**sessions.jsonl**: `session` (`S-nnnn`), `actor` (`A-nnnn`), `n`, `kind`, `started_at` (hour resolution), `duration_ms`, `ua_family`, `cookie_returned`, counters, `max_depth`, `first_path`, `last_path`, `synthetic`, `synthetic_persona`, `likely_class`, `class_confidence`, `first_referer` (`external`/null), `cohorts`, `features`, `scores`.

**events.jsonl**: `session`, `rel_ms`, `method`, `path`, `route_id`, `page_id`, `resource_kind`, `discover_class`, `depth`, `status`, `negotiated`, `robots_disallowed`, `cookie_present`, `cookie_valid`, `referer_internal`, `referer_page`, `synthetic`, `latency_bucket`, `canaries_exposed`, `canaries_seen` (`where` reduced to its category), `malformed`, `query_keys`, `accept_profile`.

**sightings.jsonl**: `ts` (hour), `canary_id`, `session`, `exposure_session`, `seen_in` (category), `cross_session`, `cross_actor`, `external`, `delta_ms`, `synthetic`.

Internal level adds truncated prefixes, raw user-agent strings, exact timestamps, sanitized query values, referer paths, header names and counts. Internal exports are never published.
