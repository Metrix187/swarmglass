import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ExperimentRegistry, pickArm, validateExperiment, variablesFor, type ExperimentDef } from '../src/experiments/registry.ts';

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
