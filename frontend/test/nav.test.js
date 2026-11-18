import assert from 'node:assert/strict';
import test from 'node:test';
import { currentNav, NAV_CHILDREN } from '../src/lib/nav.js';

test('CPU and ICT Admin can navigate to Compliance & Escalations', () => {
  const hasPerm = () => true;

  assert.ok(currentNav({ role: 'cpu' }, hasPerm).includes('compliance'));
  assert.ok(currentNav({ role: 'ictadmin' }, hasPerm).includes('compliance'));
});

test('Performance appears before Progress in overview and reports tabs', () => {
  for (const section of ['overview', 'reports']) {
    assert.equal(NAV_CHILDREN[section][0].label, 'Performance');
    assert.equal(NAV_CHILDREN[section][1].label, 'Progress');
  }
});
