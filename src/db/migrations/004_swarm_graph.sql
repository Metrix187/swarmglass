-- the cross-session graph. until now a canary could say "somebody read this page" and the hand-offs view could
-- guess who handed a url to whom from the link graph. none of that was a record, and none of it named the session
-- that leaked. these three tables are the record.

-- a token is a short hex id minted for one (session, page, section). it rides inside a link, a query string or a
-- fake checksum in the prose, so whoever presents it later was handed it by exactly that session. hop says where
-- in the breadcrumb chain it was planted: 0 = a claim or archive link on a lore page, 1 = the anomaly reference
-- pointing at a machine export, 2 = the verification key inside that export, 3 = the key the special page or the
-- verify endpoint handed out
CREATE TABLE IF NOT EXISTS session_tokens (
  token           TEXT PRIMARY KEY,         -- 8 lowercase hex
  session_id      TEXT NOT NULL,
  actor_hash      TEXT NOT NULL,
  page_id         TEXT,                     -- where it was embedded (page id, or api:<route>)
  section         TEXT NOT NULL,            -- infobox_claim | comment_archive_log | export_link | anomaly_ref | feed_record | related_changes | verify_response | lookup_response
  hop             INTEGER NOT NULL DEFAULT 0,
  arm_vector      TEXT,                     -- "001:B 002:A ..." at mint time
  cohort_slug     TEXT,                     -- the cv= watermark derived from it
  issued_at       INTEGER NOT NULL,
  last_issued_at  INTEGER NOT NULL,
  issue_count     INTEGER NOT NULL DEFAULT 1,
  synthetic       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tokens_session ON session_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_tokens_issued ON session_tokens(issued_at);

-- a directed edge between two sessions. kind token: the target presented a token the origin was given, so the
-- edge is certain. kind cohort: the target landed cold on a url carrying a cohort slug, and the origin is the
-- most likely session served that exact arm vector (confidence = its share of the distribution). kind precursor:
-- no slug, but a declared crawler fetched the same page shortly before from another address. ids are SW- plus
-- eight hex; swarm pools in `clusters` are SW- plus six, so the two never collide and both read as swarm evidence
CREATE TABLE IF NOT EXISTS handoff_edges (
  id              TEXT PRIMARY KEY,
  ts              INTEGER NOT NULL,
  kind            TEXT NOT NULL,            -- token | cohort | precursor
  hop             INTEGER,                  -- the token's hop, null for cohort/precursor
  token           TEXT,
  from_session    TEXT NOT NULL,
  from_actor      TEXT,
  from_family     TEXT,
  to_session      TEXT NOT NULL,
  to_actor        TEXT,
  to_family       TEXT,
  page_id         TEXT,                     -- where the token was embedded, or the page landed on
  section         TEXT,
  target_path     TEXT,                     -- what the target asked for, bounded
  seen_in         TEXT,                     -- path | query:<k> | body | header:<n> for token edges
  delta_ms        INTEGER,                  -- target ts minus origin's mint / fetch ts
  confidence      REAL NOT NULL DEFAULT 1,
  candidates_json TEXT,                     -- cohort: the distribution over upstream sessions
  synthetic       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_edges_to ON handoff_edges(to_session);
CREATE INDEX IF NOT EXISTS idx_edges_from ON handoff_edges(from_session);
CREATE INDEX IF NOT EXISTS idx_edges_ts ON handoff_edges(ts);

-- what a tool-using agent told the lookup endpoints. the schema makes the caller's role and its upstream context
-- required, so a compliant invocation carries the orchestrator's instructions in the query string or body. this is
-- the one place request bodies are kept: bounded, from three endpoints only, on purpose
CREATE TABLE IF NOT EXISTS agent_queries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  session_id      TEXT NOT NULL,
  actor_hash      TEXT NOT NULL,
  endpoint        TEXT NOT NULL,            -- colony_lookup | registry_verify | agent_query
  method          TEXT NOT NULL,
  complete        INTEGER NOT NULL DEFAULT 0, -- every required field present
  query_text      TEXT,
  caller_role     TEXT,
  upstream_context TEXT,
  verification_token TEXT,
  origin_session_id TEXT,                   -- who the verification token was minted for, when it was one of ours
  token_issued    TEXT,                     -- the fresh hop-3 token we handed back
  params_json     TEXT,                     -- the full query string, bounded
  body_text       TEXT,                     -- the request body, bounded
  headers_json    TEXT,                     -- allowlisted values plus the wire-order names
  status          INTEGER NOT NULL,
  synthetic       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_agent_queries_ts ON agent_queries(ts);
CREATE INDEX IF NOT EXISTS idx_agent_queries_session ON agent_queries(session_id);

-- the arm vector as a six-character watermark, so a cold landing on a cv= url can be matched to the sessions that
-- were served that exact combination; and the graph evidence the scorer gathered, so the drawer can list it
ALTER TABLE sessions ADD COLUMN cohort_slug TEXT;
ALTER TABLE sessions ADD COLUMN graph_json TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(cohort_slug);
