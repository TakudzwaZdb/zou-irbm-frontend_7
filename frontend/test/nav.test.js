import assert from 'node:assert/strict';
import test from 'node:test';
import { currentNav, isRouteAvailable, NAV_CHILDREN } from '../src/lib/nav.js';

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

test('Compliance & Escalations exposes separate progress and performance destinations', () => {
  const nav = currentNav({ role: 'cpu' }, () => true);

  assert.deepEqual(
    NAV_CHILDREN.compliance.map((child) => child.route),
    ['complianceProgress', 'compliancePerformance'],
  );
  assert.ok(isRouteAvailable('complianceProgress', nav));
  assert.ok(isRouteAvailable('compliancePerformance', nav));
});

test('submission permissions expose data entry and annual plan pages', () => {
  const permissions = new Set(['submit_data_entries', 'submit_plan_budget']);
  const nav = currentNav({ role: 'manager' }, (key) => permissions.has(key));

  assert.ok(nav.includes('entry'));
  assert.ok(nav.includes('planning'));
});
