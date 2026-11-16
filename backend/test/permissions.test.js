const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PERMS_BY_ROLE } = require('../src/utils/permissions');

test('ICT administrators inherit CPU permissions except approval permissions', () => {
  const cpuPermissions = DEFAULT_PERMS_BY_ROLE.cpu;
  const ictAdminPermissions = DEFAULT_PERMS_BY_ROLE.ictadmin;
  const approvals = ['approve_own_tier', 'approve_annual_plan'];

  for (const permission of cpuPermissions) {
    if (approvals.includes(permission)) {
      assert.equal(ictAdminPermissions.includes(permission), false);
    } else {
      assert.equal(ictAdminPermissions.includes(permission), true);
    }
  }

  assert.equal(ictAdminPermissions.includes('manage_users'), true);
  assert.equal(ictAdminPermissions.includes('apply_override'), true);
});
