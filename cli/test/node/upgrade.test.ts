import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, planUpgrade } from '../../src/upgrade.ts';

test('compareVersions orders numeric semver parts', () => {
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.0', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0', '0.10.0'), -1);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.1.0-beta.1', '0.1.0'), 0);
});

test('an outdated CLI asks for npm upgrade and a skill refresh', () => {
  const plan = planUpgrade({ current: '0.1.0', latest: '0.2.0', wiring: '0.1.0' });
  assert.equal(plan.state, 'outdated');
  assert.deepEqual(plan.commands, ['npm i -g @yidasanqian/loam@latest', 'loam install']);
});

test('a current CLI with stale wiring only refreshes the skill', () => {
  const plan = planUpgrade({ current: '0.2.0', latest: '0.2.0', wiring: '0.1.0' });
  assert.equal(plan.state, 'current');
  assert.deepEqual(plan.commands, ['loam install']);
});

test('a current CLI with matching wiring suggests nothing', () => {
  const plan = planUpgrade({ current: '0.2.0', latest: '0.2.0', wiring: '0.2.0' });
  assert.equal(plan.state, 'current');
  assert.deepEqual(plan.commands, []);
});

test('a local build ahead of npm is never told to downgrade', () => {
  const plan = planUpgrade({ current: '0.3.0', latest: '0.2.0', wiring: '0.3.0' });
  assert.equal(plan.state, 'ahead');
  assert.deepEqual(plan.commands, []);
});

test('an unreachable registry falls back to the manual commands', () => {
  const plan = planUpgrade({ current: '0.2.0', latest: null, wiring: '0.2.0' });
  assert.equal(plan.state, 'unknown');
  assert.deepEqual(plan.commands, ['npm i -g @yidasanqian/loam@latest']);
});