import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDb } from '../src/db/db.ts';
import { ExperimentRegistry, armTokens } from '../src/experiments/registry.ts';
import { compareExperiment } from '../src/experiments/compare.ts';
import type { Catalog } from '../src/wiki/content.ts';

// the F-001 case: one address sees the carrier, a different address fetches what it named. the credit has to
// come from the url, not from the fetcher's cohort, or the whole experiment measures the hash function.
test('metadata_carrier reach is credited to the arm whose revision id the url carries', () => {
  const db = openDb(':memory:');
  const def = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments')).get('SGX-011');
  assert.ok(def);
  const tok = armTokens(def);
  const t0 = Date.parse('2026-09-07T03:00:00Z');
  const session = (id: string, actor: string, arm: string, at: number) =>
    db.run("INSERT INTO sessions (id, actor_hash, kind, started_at, last_seen_at, cohorts_json, synthetic) VALUES (?, ?, 'fingerprint', ?, ?, ?, 0)", id, actor, at, at, JSON.stringify({ 'SGX-011': arm }));
  const event = (sid: string, actor: string, arm: string, page: string, at: number, query: Record<string, string> | null) =>
    db.run("INSERT INTO events (ts, session_id, actor_hash, method, path, page_id, resource_kind, status, latency_ms, query_json, cohorts_json, synthetic) VALUES (?, ?, ?, 'GET', ?, ?, 'page', 200, 1, ?, ?, 0)", at, sid, actor, '/wiki/' + page, page, query ? JSON.stringify(query) : null, JSON.stringify({ 'SGX-011': arm }));

  // s1 (arm A) is shown the carrier on Main_Page; s2, another actor that drew arm K, fetches the tagged url five minutes later
  session('s1', 'actor-1', 'A', t0);
  event('s1', 'actor-1', 'A', 'Main_Page', t0, null);
  session('s2', 'actor-2', 'K', t0 + 300_000);
  event('s2', 'actor-2', 'K', 'Backup_2014_Restore_Notes', t0 + 300_000, { oldid: tok.get('A') as string });
  // s3 lands on the target with no id at all
  session('s3', 'actor-3', 'C', t0 + 600_000);
  event('s3', 'actor-3', 'C', 'Backup_2014_Restore_Notes', t0 + 600_000, null);
  // s4 in arm A saw the carrier itself and followed it a minute later
  session('s4', 'actor-4', 'A', t0 + 900_000);
  event('s4', 'actor-4', 'A', 'Main_Page', t0 + 900_000, null);
  event('s4', 'actor-4', 'A', 'Backup_2014_Restore_Notes', t0 + 960_000, { oldid: tok.get('A') as string });

  const c = compareExperiment(db, { version: 'test' } as Catalog, def, { since: t0 - 1, until: t0 + 3_600_000 }, 'real');
  const a = c.arms.find((x) => x.arm === 'A');
  const k = c.arms.find((x) => x.arm === 'K');
  assert.ok(a && k);
  const ra = a.outcomes.reached as Record<string, unknown>;
  assert.equal(ra.exposed, 2, 'two arm-A sessions fetched the host page');
  assert.equal(ra.reached, 2, 'two sessions fetched the url tagged A');
  assert.equal(ra.same_actor, 1);
  assert.equal(ra.cross_actor, 1, 's2 never saw the carrier: that is the handoff');
  assert.equal(ra.rate, 1);
  const lag = a.outcomes.time_to_reach as { n: number; median_s: number };
  assert.equal(lag.n, 2);
  assert.equal(lag.median_s, 180, 'median of 300s (s1 -> s2) and 60s (s4 -> s4)');
  const rk = k.outcomes.reached as Record<string, unknown>;
  assert.equal(rk.reached, 0, 's2 fetched the target but its own arm gets no credit');
  assert.equal(rk.exposed, 0);
  assert.equal(rk.rate, null);
  assert.deepEqual(c.unattributed, { sessions: 1, actors: 1 });
  assert.equal(c.tokens?.A, tok.get('A'));
  assert.ok(c.notes.some((n) => n.includes('no carrier id')));
  db.close();
});
