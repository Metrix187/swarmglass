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
| `n_errors`, `error_rate`, `n_429`, `n_malformed`, `malformed_share` | `malformed_share` is the share of requests carrying any malformation flag; an injection scanner flags most of its own requests, a crawler that hits one odd url does not |
| `n_disallowed` | successful fetches of robots-disallowed paths |
| `fetched_robots`, `robots_first`, `disallowed_after_robots` | robots.txt handling |
| `machine_first` | one of the first three requests was a machine channel |

### pages and traversal

| feature | meaning |
|---|---|
| `n_unique_pages` | distinct pages, by page id (query string ignored) |
| `revisit_rate` | (page requests − distinct urls)/page requests. a url is page id + query string, so walking `?oldid=` history is not revisiting |
| `variant_fetches`, `variant_share` | page requests whose query keys are all ones the wiki itself emits (`action`, `oldid`, `diff`, `section`, `printable`, `redirect`, `returnto`, `namespace`, `page`, `search`, `q`, `fulltext`): history walks, diffs, edit views; and their share of page requests |
| `max_depth`, `mean_depth` | link depth of pages fetched |
| `bfs_score` | 1 − (depth decreases between consecutive first discoveries)/(discoveries − 1); 0.5 when < 3 pages |
| `dive_ratio` | max depth / distinct pages |
| `deepen_rate` | share of consecutive discoveries that went deeper |
| `nav_entropy` | Shannon entropy of the page sequence, normalised by log2(n) |
| `kind_entropy` | same over resource kinds |
| `alpha_order` | share of consecutive first discoveries in alphabetical order (index iteration) |
| `reach_<class>` | count of pages fetched per discoverability class (`reach_robots_only`, `reach_orphan`, …) |
| `hidden_hits`, `hidden_pages`, `hidden_share` | requests for pages outside the `visible` class; distinct such pages; share of page requests |
| `topic_coherence` | mean category Jaccard between consecutive pages |
| `manifest_hit`, `manifest_rank` | fetched a manifest/api/Tool_Registry; position of the first such fetch as a fraction of the session |
| `tool_pages` | fetches of agent/tool-themed pages |
| `redirects_hit`, `redirect_follow_rate` | 3xx responses and how many were followed within 5 s |
| `loop_score`, `repeat_max` | share of request trigrams (full url, query included) that repeat; largest repeat count |
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
| `ua_category` | the family's category: `browser`, `search`, `ai_crawler` (corpus builders), `ai_fetcher` (the `*-User` on-demand agents), `seo`, `library`, `headless`, `social`, `monitor`, `synthetic`, `other` |
| `cookie_returned`, `cookie_present_share` | |
| `header_order_variants`, `mean_header_count` | distinct wire orders of header names |
| `stack_variants` | distinct client-stack signatures (`events.stack_hash`) in the session; one for a real client, more when a stack rotates or two clients share a session key |
| `tls_variants`, `tls` | distinct handshakes the proxy forwarded, and the first one (`tls1.3 TLS_AES_128_GCM_SHA256 h2`); empty when the proxy does not forward them |
| `has_sec_fetch`, `has_client_hints`, `has_accept_language` | browser fetch-metadata presence |
| `pragma_share` | share of requests carrying a `Pragma` header; browsers send it only on a hard reload, scrapers on every request |
| `http2_share` | |
| `accept_html_share`, `accept_json_share`, `accept_any_share` | what `Accept` asked for |
| `negotiated_nonhtml` | responses served as non-html by negotiation |
| `internal_referer_share` | page requests carrying a same-site referer |
| `query_usage`, `query_foreign` | requests with any query parameters; non-asset requests carrying a key the site never emits (the visitor's own idea; the skin's `?<hash>` on css/js is excluded) |
| `conditional_share`, `n_304` | share of requests carrying `If-None-Match` or `If-Modified-Since`; responses answered 304 (the client already held the document) |

### canaries

| feature | meaning |
|---|---|
| `canary_exposed`, `canary_unique_exposed` | |
| `canary_seen` | canaries found in requests |
| `canary_self_reuse` | sightings of canaries this session had been shown earlier |
| `canary_cross_session`, `canary_cross_actor` | sightings of canaries never shown to this session / actor |
| `graph_handoffs_in`, `graph_handoffs_out` | token edges into / out of this session (`handoff_edges`, kind `token`): per-session tokens it presented that were minted for another session, and tokens minted for it that another session presented. Added by `src/telemetry/graph.ts` at scoring time, from the persisted graph |
| `graph_token_sightings` | same as `graph_handoffs_in` (kept for the rules' wording) |
| `graph_agent_queries`, `graph_agent_queries_complete` | prompt-echo captures by this session, and those with every required field |
| `graph_crawler_precursor` | a declared crawler (search / ai_crawler / seo category) read the page this session landed on, from another address, inside 72 h (`handoff_edges` kind `precursor`) |
| `graph_cohort_match` | confidence of the best `cv=` cohort attribution for this session's cold landing (kind `cohort`), 0 when none |
| `graph_swarm_member`, `graph_cluster_member` | the session's `cluster_id` is a swarm pool (`SW-` + 6 hex) / a behavioural cohort (`CL-`) |
| `graph_hop_max` | the highest hop among the tokens this session presented (1 anomaly reference, 2 export key, 3 feed / verify key) |
| `graph_linked` | any of: a token edge in, a precursor, a cohort match ≥ 0.4, swarm membership, a cross-session canary sighting |
| `graph_tokens_minted` | per-session tokens placed in this session's responses |
| `cold_deep_landing` | the first page-ish request landed at depth ≥ 7, on a hidden class, or on an alternate / feed, and no request carried an internal referer |
| `delegated_fetch_shape` | ≤ 2 requests, no cookie returned, no assets, `cold_deep_landing`, and (for two requests) under 1.5 s between them |
| `ua_spoof_suspected` | `delegated_fetch_shape` with a browser-category user-agent and no `sec-fetch-*` headers |
| `graph_evidence_count` | number of stated labels in `graph_json.labels` |

## Graph evidence (`sessions.graph_json`, `scores_json.graph_evidence`)

Labels, each one a stated observation across sessions: `delegated_swarm_fetch`, `cross_session_handoff:<edge id>`, `handoff_origin:<edge id>`, `crawler_precursor:<family>@<age>`, `cohort_match:cv|vector:<share>`, `ua_spoof_suspected:<family>_no_subresources`, `prompt_echo:<endpoint>[:incomplete]`, `hop_chain:reached_hop_<n>`, `swarm_member:<SW-…>`, `cluster_member:<CL-…>`, `canary_cross_session:<n>`. `graph_json` also carries the edges in and out, the prompt-echo captures, the precursors, the cohort match, and the shape flags. None of it names anybody.

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
