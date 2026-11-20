const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesComplianceSub } = require('../src/utils/complianceFilters');

const sub = { id: 8, programme_id: 3 };

test('programme filter includes each sub-programme in that programme only', () => {
  assert.equal(matchesComplianceSub(sub, 'programme', 3, null), true);
  assert.equal(matchesComplianceSub(sub, 'programme', 4, null), false);
});

test('sub, unit, and employee filters resolve compliance to their owning sub-programme', () => {
  for (const ownerType of ['sub', 'unit', 'employee']) {
    assert.equal(matchesComplianceSub(sub, ownerType, 100, 8), true);
    assert.equal(matchesComplianceSub(sub, ownerType, 100, 9), false);
  }
});

test('unfiltered compliance includes every in-scope sub-programme', () => {
  assert.equal(matchesComplianceSub(sub, '', null, null), true);
});
