const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canReadKpi } = require('../src/utils/scope');

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
