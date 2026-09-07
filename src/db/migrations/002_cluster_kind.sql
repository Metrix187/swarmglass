-- clusters were only ever behavioural groups. a swarm is a second kind: one client signature spread
-- across many networks, one hit each, found by a different detector over a longer window. same table,
-- a kind column, and a summary blob the console can render without re-deriving anything.
ALTER TABLE clusters ADD COLUMN kind TEXT NOT NULL DEFAULT 'behaviour';
ALTER TABLE clusters ADD COLUMN summary_json TEXT;
