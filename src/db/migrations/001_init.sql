-- swarmglass core schema. timestamps are unix ms integers; json columns hold small bounded blobs.
-- privacy note: no raw ip is stored unless SWARMGLASS_PRIVACY_IP_MODE=none, and even then only in ip_raw.

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  actor_hash      TEXT NOT NULL,            -- hmac(ip_trunc | ua | accept-*) — coarse, non-reversible
  kind            TEXT NOT NULL,            -- cookie | fingerprint
  started_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  ended_at        INTEGER,
  ip_trunc        TEXT,                     -- a.b.c.0/24 or v6 /48
  ip_hash         TEXT,                     -- hmac with rotating daily salt
  ua              TEXT,                     -- allowlisted raw ua (bounded)
  ua_hash         TEXT,
  ua_family       TEXT,                     -- rule-based family label
  cookie_returned INTEGER NOT NULL DEFAULT 0,
  n_requests      INTEGER NOT NULL DEFAULT 0,
  n_pages         INTEGER NOT NULL DEFAULT 0,
  n_unique_pages  INTEGER NOT NULL DEFAULT 0,
  n_errors        INTEGER NOT NULL DEFAULT 0,
  n_head          INTEGER NOT NULL DEFAULT 0,
  n_post          INTEGER NOT NULL DEFAULT 0,
  n_disallowed    INTEGER NOT NULL DEFAULT 0,
  n_subresources  INTEGER NOT NULL DEFAULT 0,
  n_machine       INTEGER NOT NULL DEFAULT 0, -- robots/sitemap/feed/api/manifest fetches
  max_depth       INTEGER NOT NULL DEFAULT 0,
  first_path      TEXT,
  last_path       TEXT,
  first_referer_host TEXT,
  synthetic       INTEGER NOT NULL DEFAULT 0,
  synthetic_run   TEXT,
  synthetic_persona TEXT,
  cohorts_json    TEXT,                     -- {"SGX-001":"A",...}
  features_json   TEXT,
  scores_json     TEXT,
  likely_class    TEXT,
  class_confidence REAL,
  cluster_id      TEXT,
  scored_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_synthetic ON sessions(synthetic);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(likely_class);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  session_id      TEXT NOT NULL,
  actor_hash      TEXT NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,            -- request path (bounded, scrubbed)
  route_id        TEXT,                     -- which handler answered
  page_id         TEXT,                     -- wiki page id when applicable
  resource_kind   TEXT NOT NULL,            -- page | special | alt | api | manifest | robots | sitemap | feed | attachment | asset | redirect | missing | gone | other
  discover_class  TEXT,                     -- discoverability class of the target (from the page catalog)
  depth           INTEGER,
  status          INTEGER NOT NULL,
  latency_ms      REAL NOT NULL,
  bytes_out       INTEGER NOT NULL DEFAULT 0,
  http_version    TEXT,
  proto           TEXT,                     -- http | https (from proxy header)
  host            TEXT,
  ua_hash         TEXT,
  accept          TEXT,
  accept_lang     TEXT,
  accept_enc      TEXT,
  referer         TEXT,                     -- same-origin referers kept as path; external kept as host only
  referer_internal INTEGER NOT NULL DEFAULT 0,
  query_json      TEXT,                     -- sanitized {k: v} (bounded)
  header_names    TEXT,                     -- ordered header names, joined by ","
  header_order_hash TEXT,
  header_count    INTEGER,
  cookie_present  INTEGER NOT NULL DEFAULT 0,
  cookie_valid    INTEGER NOT NULL DEFAULT 0,
  negotiated      TEXT,                     -- representation actually served: html | json | text | yaml | xml
  robots_disallowed INTEGER NOT NULL DEFAULT 0,
  canaries_exposed TEXT,                    -- json array of canary ids in the response
  canaries_seen   TEXT,                     -- json array of {id, where}
  cohorts_json    TEXT,
  synthetic       INTEGER NOT NULL DEFAULT 0,
  synthetic_run   TEXT,
  malformed       TEXT,                     -- json array of malformation flags, null if clean
  body_bytes      INTEGER NOT NULL DEFAULT 0,
  body_ctype      TEXT,
  extra_json      TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_events_page ON events(page_id);
CREATE INDEX IF NOT EXISTS idx_events_path ON events(path);
CREATE INDEX IF NOT EXISTS idx_events_synthetic ON events(synthetic);

CREATE TABLE IF NOT EXISTS canaries (
  id              TEXT PRIMARY KEY,         -- QUANTARA-SWARMGLASS-R7-4F91C2
  scope           TEXT NOT NULL,            -- R route | S session | E experiment | C campaign
  route_no        INTEGER,
  page_id         TEXT,
  placement       TEXT NOT NULL,            -- visible | comment | meta | jsonld | header | feed | api | attachment | text | json | yaml | manifest | sitemap
  experiment_id   TEXT,
  arm             TEXT,
  session_id      TEXT,                     -- only for S scope
  seed_version    TEXT,
  first_issued_at INTEGER NOT NULL,
  last_issued_at  INTEGER NOT NULL,
  issue_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_canaries_page ON canaries(page_id);
CREATE INDEX IF NOT EXISTS idx_canaries_session ON canaries(session_id);

CREATE TABLE IF NOT EXISTS canary_sightings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  canary_id       TEXT NOT NULL,
  session_id      TEXT,                     -- null for external sightings
  actor_hash      TEXT,
  seen_in         TEXT NOT NULL,            -- path | query | referer | ua | header:<name> | body | cookie | external:<source>
  path            TEXT,
  detail          TEXT,                     -- bounded context (never a raw header dump)
  cross_session   INTEGER NOT NULL DEFAULT 0,   -- seen by a session that was never exposed to it
  cross_actor     INTEGER NOT NULL DEFAULT 0,   -- seen by an actor that was never exposed to it
  exposure_session_id TEXT,                 -- who was originally exposed (for S canaries)
  delta_ms        INTEGER,                  -- time since first exposure
  external        INTEGER NOT NULL DEFAULT 0,
  synthetic       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sightings_ts ON canary_sightings(ts);
CREATE INDEX IF NOT EXISTS idx_sightings_canary ON canary_sightings(canary_id);
CREATE INDEX IF NOT EXISTS idx_sightings_session ON canary_sightings(session_id);

-- which session was exposed to which canary, first time only. keeps sightings attributable.
CREATE TABLE IF NOT EXISTS canary_exposures (
  canary_id       TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  actor_hash      TEXT NOT NULL,
  first_at        INTEGER NOT NULL,
  placement       TEXT NOT NULL,
  PRIMARY KEY (canary_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_exposures_session ON canary_exposures(session_id);
CREATE INDEX IF NOT EXISTS idx_exposures_actor ON canary_exposures(actor_hash);

-- first time a session reached a page, and how we think it got there
CREATE TABLE IF NOT EXISTS page_discoveries (
  session_id      TEXT NOT NULL,
  page_id         TEXT NOT NULL,
  ts              INTEGER NOT NULL,
  via             TEXT NOT NULL,            -- referer:<page> | channel:<robots|sitemap|feed|jsonld|header|manifest|api|index|stale_index> | direct | unknown
  discover_class  TEXT,
  depth           INTEGER,
  order_no        INTEGER NOT NULL,         -- nth distinct page in the session
  PRIMARY KEY (session_id, page_id)
);
CREATE INDEX IF NOT EXISTS idx_discoveries_page ON page_discoveries(page_id);

CREATE TABLE IF NOT EXISTS nav_edges (
  session_id      TEXT NOT NULL,
  from_page       TEXT NOT NULL,
  to_page         TEXT NOT NULL,
  ts              INTEGER NOT NULL,
  kind            TEXT NOT NULL             -- referer | sequence
);
CREATE INDEX IF NOT EXISTS idx_edges_session ON nav_edges(session_id);

CREATE TABLE IF NOT EXISTS clusters (
  id              TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  window_start    INTEGER NOT NULL,
  window_end      INTEGER NOT NULL,
  size            INTEGER NOT NULL,
  signals_json    TEXT NOT NULL,            -- [{signal, strength, note}]
  swarm_score     REAL NOT NULL,
  label           TEXT,
  synthetic       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS experiment_runs (
  experiment_id   TEXT NOT NULL,
  version         INTEGER NOT NULL,
  activated_at    INTEGER NOT NULL,
  deactivated_at  INTEGER,
  definition_json TEXT NOT NULL,
  seed_version    TEXT,
  heuristics_version INTEGER,
  PRIMARY KEY (experiment_id, version)
);

CREATE TABLE IF NOT EXISTS synthetic_runs (
  id              TEXT PRIMARY KEY,
  started_at      INTEGER NOT NULL,
  finished_at     INTEGER,
  personas_json   TEXT NOT NULL,
  note            TEXT
);

CREATE TABLE IF NOT EXISTS console_sessions (
  id              TEXT PRIMARY KEY,
  user            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  csrf            TEXT NOT NULL,
  ip_trunc        TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  user            TEXT,
  action          TEXT NOT NULL,
  detail          TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  k               TEXT PRIMARY KEY,
  v               TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);

-- daily rollups so the overview stays cheap at scale
CREATE TABLE IF NOT EXISTS daily_stats (
  day             TEXT NOT NULL,
  synthetic       INTEGER NOT NULL,
  requests        INTEGER NOT NULL DEFAULT 0,
  sessions        INTEGER NOT NULL DEFAULT 0,
  errors          INTEGER NOT NULL DEFAULT 0,
  canary_sightings INTEGER NOT NULL DEFAULT 0,
  by_class_json   TEXT,
  by_kind_json    TEXT,
  PRIMARY KEY (day, synthetic)
);
