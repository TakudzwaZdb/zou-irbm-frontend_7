const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canReadKpi, performanceRootKey } = require('../src/utils/scope');

test('institutional performance permission grants all-KPI read scope without changing the user role', async () => {
  const scopedUser = {
    role: 'unithead',
    scope_type: 'unit',
    scope_id: 1,
    permissions: ['submit_data_entries'],
  };
  const otherProgrammeKpi = { owner_type: 'sub', owner_id: 999 };

  assert.equal(await canReadKpi(scopedUser, otherProgrammeKpi), false);
  assert.equal(
    await canReadKpi({
      ...scopedUser,
      permissions: [...scopedUser.permissions, 'view_institutional_performance'],
    }, otherProgrammeKpi),
    true,
  );
});

test('a scoped custom role can read only KPIs within its assigned scope', async () => {
  const scopedUser = {
    role: 'manager',
    scope_type: 'unit',
    scope_id: 30,
    permissions: ['view_overview'],
  };

  assert.equal(await canReadKpi(scopedUser, { owner_type: 'unit', owner_id: 30 }), true);
  assert.equal(await canReadKpi(scopedUser, { owner_type: 'unit', owner_id: 31 }), false);
  assert.equal(await canReadKpi(scopedUser, { owner_type: 'sub', owner_id: 20 }), false);
  assert.equal(performanceRootKey(scopedUser), 'unit:30');
  assert.equal(performanceRootKey({
    role: 'unithead',
    scope_type: 'programme',
    scope_id: 10,
    permissions: [],
  }), 'programme:10');
  assert.equal(performanceRootKey({
    role: 'ictadmin',
    scope_type: 'unit',
    scope_id: 30,
    permissions: [],
  }), 'unit:30');
  assert.equal(performanceRootKey({ role: 'ictadmin', permissions: [] }), 'university:0');
  assert.equal(performanceRootKey({
    role: 'ictadmin',
    scope_type: 'unit',
    scope_id: 30,
    permissions: ['view_institutional_performance'],
  }), 'university:0');
  assert.equal(performanceRootKey({ role: 'manager', permissions: [] }), null);
});
