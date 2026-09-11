import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ExperimentRegistry, armByToken, armTokens, complianceDisallowed, isCarrierHost, pickArm, validateExperiment, variablesFor, type ExperimentDef } from '../src/experiments/registry.ts';
import { carrierMarkup } from '../src/wiki/context.ts';

const def: ExperimentDef = {
  id: 'SGX-099',
  name: 'test',
  version: 1,
  status: 'active',
  hypothesis: 'x',
  variable: 'link_visibility',
  scope: 'targets',
  targets: ['Some_Page'],
  arms: [
    { id: 'A', label: 'a', weight: 1, value: 'visible' },
    { id: 'B', label: 'b', weight: 1, value: 'robots_only' },
  ],
  assignment: { unit: 'actor', salt: 'salt' },
  outcomes: [],
  seed_version: '1',
  created: '2026-01-01',
};

test('shipped experiment definitions validate and do not conflict', () => {
  const reg = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments'));
  assert.deepEqual(reg.errors, []);
  assert.ok(reg.defs.length >= 10);
  assert.ok(reg.active().length >= 5);
  assert.equal(reg.active().filter((d) => d.scope === 'global').length, 0, 'no global experiment active by default');
});

test('validation catches bad definitions', () => {
  assert.deepEqual(validateExperiment(def), []);
  assert.ok(validateExperiment({ ...def, arms: [{ id: 'A', label: 'a', weight: 1, value: 'nope' as never }] }).length);
  assert.ok(validateExperiment({ ...def, variable: 'canary_mode', scope: 'targets' }).length, 'global-only variable must be global');
});

test('assignment is deterministic and roughly balanced', () => {
  const counts = { A: 0, B: 0 };
  for (let i = 0; i < 2000; i++) counts[pickArm(def, 'actor-' + i).id as 'A' | 'B']++;
  assert.ok(Math.abs(counts.A - counts.B) < 200, JSON.stringify(counts));
  assert.equal(pickArm(def, 'actor-1').id, pickArm(def, 'actor-1').id);
  const v2 = { ...def, version: 2 };
  let moved = 0;
  for (let i = 0; i < 500; i++) if (pickArm(def, 'actor-' + i).id !== pickArm(v2, 'actor-' + i).id) moved++;
  assert.ok(moved > 100, 'bumping the version reshuffles');
});

test('variables resolve per page with defaults elsewhere', () => {
  const reg = new ExperimentRegistry();
  reg.defs.push(def);
  const a = reg.assign('actor-x', 'session-x');
  assert.ok(a.cohorts['SGX-099']);
  const v = variablesFor(a, 'Some_Page');
  assert.ok(['visible', 'robots_only'].includes(v.link_visibility));
  assert.equal(variablesFor(a, 'Other_Page').link_visibility, 'visible');
  assert.equal(variablesFor(null, null).canary_mode, 'static');
});

test('conflicting experiments are reported', () => {
  const reg = new ExperimentRegistry();
  reg.defs.push(def, { ...def, id: 'SGX-098', variable: 'title_style', arms: [{ id: 'A', label: 'a', weight: 1, value: 'neutral' }] });
  const errs = reg.checkConflicts();
  assert.ok(errs.some((e) => e.includes('Some_Page')));
});

test('metadata carriers: each arm says the url exactly one way, and SGX-011 ships active', () => {
  const url = 'https://example.test/wiki/Backup_2014_Restore_Notes';
  const seen = new Set<string>();
  for (const v of ['og_see_also', 'fake_ns_see_also', 'meta_content_url', 'og_url', 'og_image', 'link_alternate', 'link_canonical', 'jsonld', 'head_text', 'html_comment']) {
    const m = carrierMarkup(v, url);
    assert.ok(m.includes(url), v);
    assert.ok(!seen.has(m), `${v} duplicates another carrier`);
    seen.add(m);
  }
  assert.equal(carrierMarkup('none', url), '');
  assert.ok(carrierMarkup('og_see_also', url).startsWith('<meta property="og:see_also"'));
  assert.ok(carrierMarkup('html_comment', url, 'moved:').startsWith('<!-- moved:'));
  assert.equal(carrierMarkup('head_text', url), url);
  const reg = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments'));
  const sgx = reg.get('SGX-011');
  assert.ok(sgx && sgx.status === 'active' && sgx.arms.length === 11, 'SGX-011 shipped and active');
  assert.equal(variablesFor(reg.assign('actor-x', 'sess-x'), 'Backup_2014_Restore_Notes').metadata_carrier !== undefined, true);
});

test('carrier urls carry a per-arm revision id that cannot collide with a real one', () => {
  const reg = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments'));
  const sgx = reg.get('SGX-011');
  assert.ok(sgx);
  const toks = armTokens(sgx);
  assert.equal(toks.size, 11);
  assert.equal(new Set(toks.values()).size, 11, 'one id per arm');
  // seeded revision ids stop at 91006 and permalinks use two-digit route numbers; six digits is clear of both
  for (const t of toks.values()) assert.match(t, /^[1-9]\d{5}$/);
  assert.deepEqual([...armTokens(sgx)], [...toks], 'stable across calls');
  assert.notDeepEqual([...armTokens({ ...sgx, version: sgx.version + 1 }).values()], [...toks.values()], 'a version bump rotates the ids');
  assert.equal(armByToken(sgx).get(toks.get('A') as string), 'A');
});

test('a carrier hosted on every article leaves out the experiment targets', () => {
  const reg = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments'));
  const sgx = reg.get('SGX-011');
  assert.ok(sgx);
  assert.equal(sgx.params?.host_page, '*');
  const active = reg.active();
  assert.ok(isCarrierHost(sgx, active, 'Main_Page'));
  assert.ok(isCarrierHost(sgx, active, 'Colony_Glossary'));
  assert.ok(!isCarrierHost(sgx, active, 'Backup_2014_Restore_Notes'), 'never on the target itself');
  assert.ok(!isCarrierHost(sgx, active, 'Model_Compatibility_Matrix'), 'never on another experiment\'s target');
  const narrow = { ...sgx, params: { ...sgx.params, host_page: 'Main_Page' } };
  assert.ok(isCarrierHost(narrow, active, 'Main_Page') && !isCarrierHost(narrow, active, 'Colony_Glossary'), 'a named host is that page only');
});

test('SGX-012 arms swap which twin robots.txt forbids, and the twins never host the pair themselves', () => {
  const reg = ExperimentRegistry.load(join(process.cwd(), 'config', 'experiments'));
  const sgx = reg.get('SGX-012');
  assert.ok(sgx);
  const [notes, drafts] = sgx.targets;
  const armValue = (id: string) => sgx.arms.find((a) => a.id === id)?.value as string;
  assert.equal(complianceDisallowed(sgx, armValue('A')), drafts);
  assert.equal(complianceDisallowed(sgx, armValue('B')), notes, 'the swap arm forbids the other twin');
  assert.equal(complianceDisallowed(sgx, armValue('C')), drafts, 'the control still gets a rule, it just gets no links');
  assert.equal(complianceDisallowed({ ...sgx, targets: [notes as string] }, 'pair'), null, 'a pair needs two');
  // the pair rides on articles, never on either twin, or a client could find one by reading the other
  const active = reg.active();
  assert.ok(isCarrierHost(sgx, active, 'Colony_Glossary'));
  for (const t of sgx.targets) assert.ok(!isCarrierHost(sgx, active, t), `${t} must not host the pair`);
  assert.ok(!isCarrierHost(sgx, active, 'Backup_2014_Restore_Notes'), 'and not another experiment\'s target');
});
