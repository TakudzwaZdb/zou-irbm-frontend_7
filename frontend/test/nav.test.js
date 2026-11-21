import assert from 'node:assert/strict';
import test from 'node:test';
import { currentNav, defaultRoute, isRouteAvailable, NAV_CHILDREN } from '../src/lib/nav.js';

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

test('Overview defaults to Performance while Progress remains available', () => {
  const nav = currentNav({ role: 'unithead' }, () => true);

  assert.equal(defaultRoute(nav), 'entry');
  assert.ok(isRouteAvailable('overviewPerformance', nav));
  assert.ok(isRouteAvailable('overview', nav));
  assert.equal(defaultRoute(['overview', 'reports']), 'overviewPerformance');
});

test('every role can reach both Overview views when granted view_overview', () => {
  const roles = ['employee', 'unithead', 'rep', 'programme', 'cpu', 'ictadmin', 'exec', 'vc', 'council', 'manager'];
  for (const role of roles) {
    const nav = currentNav({ role }, (permission) => permission === 'view_overview');
    assert.ok(isRouteAvailable('overviewPerformance', nav), `${role} should be able to open Overview Performance`);
    assert.ok(isRouteAvailable('overview', nav), `${role} should be able to open Overview Progress`);
  }

  const revoked = currentNav({ role: 'unithead' }, () => false);
  assert.equal(isRouteAvailable('overviewPerformance', revoked), false);
  assert.equal(isRouteAvailable('overview', revoked), false);
});

test('Compliance & Escalations is one destination while older links remain routable', () => {
  const nav = currentNav({ role: 'cpu' }, () => true);

  assert.deepEqual(NAV_CHILDREN.compliance, []);
  assert.ok(nav.includes('compliance'));
  assert.ok(isRouteAvailable('complianceProgress', nav));
  assert.ok(isRouteAvailable('compliancePerformance', nav));
});

test('submission permissions expose data entry and annual plan pages', () => {
  const permissions = new Set(['submit_data_entries', 'submit_plan_budget']);
  const nav = currentNav({ role: 'manager' }, (key) => permissions.has(key));

  assert.ok(nav.includes('entry'));
  assert.ok(nav.includes('planning'));
});
