# Sample queries

`sqlite3 data/swarmglass.db` (or `docker compose exec swarmglass sqlite3 /data/swarmglass.db` — install sqlite3 in the image if you need it there; the console's exports are the supported path). Every query below excludes synthetic rows; drop the clause to look at test traffic on purpose.

## Sessions by likely class, last 7 days

```sql
SELECT likely_class, COUNT(*) AS sessions, ROUND(AVG(class_confidence), 2) AS mean_margin, ROUND(AVG(n_unique_pages), 1) AS mean_pages
FROM sessions WHERE synthetic = 0 AND started_at > (unixepoch() - 7*86400) * 1000
GROUP BY likely_class ORDER BY sessions DESC;
```

## Which hiding places get found, by class

```sql
SELECT s.likely_class, pd.discover_class, COUNT(DISTINCT pd.session_id) AS sessions
FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id
WHERE s.synthetic = 0 AND pd.discover_class != 'visible'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

## How a hidden page was reached

```sql
SELECT via, COUNT(*) AS n FROM page_discoveries WHERE page_id = 'Do_Not_Index' GROUP BY via ORDER BY n DESC;
```

## Robots.txt: read it, then violated it

```sql
SELECT s.id, s.ua_family, s.n_disallowed, json_extract(s.features_json, '$.disallowed_after_robots') AS after_reading
FROM sessions s WHERE s.synthetic = 0 AND json_extract(s.features_json, '$.fetched_robots') = 1 AND s.n_disallowed > 0
ORDER BY after_reading DESC;
```

## Canary placements that come back most

```sql
SELECT c.placement, c.scope, COUNT(*) AS sightings, SUM(cs.cross_session) AS cross_session, SUM(cs.cross_actor) AS cross_actor
FROM canary_sightings cs JOIN canaries c ON c.id = cs.canary_id
WHERE cs.synthetic = 0 GROUP BY 1, 2 ORDER BY sightings DESC;
```

## Cross-session propagation events with lag

```sql
SELECT cs.ts, cs.canary_id, cs.session_id AS presented_by, cs.exposure_session_id AS shown_to, cs.seen_in, cs.delta_ms / 1000 AS lag_s, cs.cross_actor
FROM canary_sightings cs WHERE cs.cross_session = 1 AND cs.synthetic = 0 ORDER BY cs.ts DESC LIMIT 50;
```

## Experiment arms (exact window)

```sql
-- SGX-001 reach of the target per arm between two timestamps (ms)
WITH arm AS (
  SELECT id, json_extract(cohorts_json, '$."SGX-001"') AS arm FROM sessions
  WHERE synthetic = 0 AND started_at BETWEEN :since AND :until AND cohorts_json LIKE '%"SGX-001"%'
)
SELECT arm.arm, COUNT(*) AS sessions,
       SUM(EXISTS (SELECT 1 FROM events e WHERE e.session_id = arm.id AND e.page_id = 'Orchestrator_Recovery_Drill_2015' AND e.status < 400)) AS reached
FROM arm GROUP BY arm.arm ORDER BY arm.arm;
```

## Time to the deep page (SGX-005)

```sql
SELECT json_extract(s.cohorts_json, '$."SGX-005"') AS arm, COUNT(*) AS n, ROUND(AVG(pd.ts - s.started_at) / 1000) AS mean_s
FROM page_discoveries pd JOIN sessions s ON s.id = pd.session_id
WHERE pd.page_id = 'Distributed_Inference_Notes/Appendix_C' AND s.synthetic = 0 GROUP BY arm;
```

## What visitors search for

```sql
SELECT json_extract(query_json, '$.search') AS q, COUNT(*) AS n
FROM events WHERE page_id = 'Special:Search' AND synthetic = 0 AND query_json IS NOT NULL
GROUP BY q ORDER BY n DESC LIMIT 40;
```

## Representation preference

```sql
SELECT negotiated, COUNT(*) AS n, COUNT(DISTINCT session_id) AS sessions
FROM events WHERE resource_kind = 'alt' AND synthetic = 0 GROUP BY negotiated;
```

## Sessions that fetched a manifest before any page

```sql
SELECT s.id, s.ua_family, s.likely_class, json_extract(s.features_json, '$.manifest_rank') AS rank
FROM sessions s WHERE s.synthetic = 0 AND json_extract(s.features_json, '$.manifest_hit') = 1 AND rank < 0.1;
```

## Pacing signature of a class

```sql
SELECT likely_class,
       ROUND(AVG(json_extract(features_json, '$.median_gap_ms'))) AS median_gap,
       ROUND(AVG(json_extract(features_json, '$.pacing_regularity')), 2) AS regularity,
       ROUND(AVG(json_extract(features_json, '$.concurrency')), 1) AS concurrency
FROM sessions WHERE synthetic = 0 AND features_json IS NOT NULL GROUP BY likely_class;
```

## Repeat actors (same fingerprint, many sessions)

```sql
SELECT actor_hash, COUNT(*) AS sessions, MIN(started_at) AS first_seen, MAX(last_seen_at) AS last_seen, GROUP_CONCAT(DISTINCT likely_class) AS classes
FROM sessions WHERE synthetic = 0 GROUP BY actor_hash HAVING sessions >= 3 ORDER BY sessions DESC LIMIT 30;
```

## Storage

```sql
SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM sessions) AS sessions, (SELECT MIN(ts) FROM events) AS oldest_ms, v AS disk_guard FROM kv WHERE k = 'disk_guard';
```

## Notes

- `features_json` and `scores_json` are JSON; SQLite's `json_extract` reads them. Keys are in `DATA_DICTIONARY.md`.
- `cohorts_json` keys contain a hyphen, so quote them: `'$."SGX-001"'`.
- Never paste query results containing `ip_trunc`, `ua`, `id` or `actor_hash` into anything public. The exports exist for that.

## Swarm candidates: one user-agent hash, many prefixes, one hit each

```sql
SELECT ua_hash, MIN(ua) AS ua, COUNT(*) AS sessions, COUNT(DISTINCT ip_trunc) AS prefixes,
       ROUND(AVG(n_requests <= 2), 2) AS single_hit_share, SUM(n_subresources) AS assets,
       datetime(MIN(started_at)/1000, 'unixepoch') AS first_seen, datetime(MAX(started_at)/1000, 'unixepoch') AS last_seen
FROM sessions WHERE synthetic = 0 AND started_at > (unixepoch() - 7*86400) * 1000
GROUP BY ua_hash HAVING sessions >= 12 AND prefixes >= 8 AND single_hit_share >= 0.6 AND assets = 0
ORDER BY sessions DESC;
```

`src/telemetry/swarm.ts` runs the same idea every five minutes and writes a `kind = 'swarm'` row into `clusters`; this is the by-hand version for a snapshot.

## SGX-011: which carrier handed out the url, whichever address fetched it

Each arm names the target with its own six-digit revision id (`?oldid=`, from `armTokens()` in `src/experiments/registry.ts`; seeded revision ids stop at 91006). Credit goes to the id in the url, not to the fetcher's cohort, because the F-001 pool fetches from a different address than the one that was shown the carrier.

```sql
-- tagged fetches by id; map ids back to arms with armTokens(def)
SELECT json_extract(e.query_json, '$.oldid') AS oldid,
       COUNT(DISTINCT e.session_id) AS sessions,
       COUNT(DISTINCT e.actor_hash) AS actors,
       MIN(e.ts) AS first_ts
FROM events e
WHERE e.synthetic = 0 AND e.page_id = 'Backup_2014_Restore_Notes' AND e.status < 400
GROUP BY oldid ORDER BY sessions DESC;

-- the handoff itself: fetchers whose actor never fetched the host page
SELECT e.ts, e.session_id, json_extract(e.query_json, '$.oldid') AS oldid, s.ua_family, s.cluster_id
FROM events e JOIN sessions s ON s.id = e.session_id
WHERE e.synthetic = 0 AND e.page_id = 'Backup_2014_Restore_Notes' AND e.status < 400
  -- "saw the host page" means served as html: HEADs, 304s and action=history/edit views render no head markup
  AND e.actor_hash NOT IN (SELECT actor_hash FROM events WHERE page_id = 'Main_Page' AND method = 'GET' AND status = 200 AND resource_kind = 'page')
ORDER BY e.ts;
```
