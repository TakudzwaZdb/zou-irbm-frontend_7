const { test } = require('node:test');
const assert = require('node:assert/strict');
const { appendAlertOwnerFilter } = require('../src/utils/performanceAlertFilters');

test('programme filter includes directly owned KPIs and descendants with correct SQL parameters', () => {
  const params = [2026, 11, 'open'];

  const filter = appendAlertOwnerFilter('programme', 7, params);

  assert.equal(
    filter,
    " AND ((k.owner_type = 'programme' AND k.owner_id = $4) OR p.id = $5)",
  );
  assert.deepEqual(params, [2026, 11, 'open', 7, 7]);
});

test('sub, unit, and employee filters use their owner relationship columns', () => {
  for (const [ownerType, column] of [['sub', 's.id'], ['unit', 'u.id'], ['employee', 'e.id']]) {
    const params = [2026, 11];
    assert.equal(appendAlertOwnerFilter(ownerType, 9, params), ` AND ${column} = $3`);
    assert.deepEqual(params, [2026, 11, 9]);
  }
});

test('an unfiltered scope does not add SQL or parameters', () => {
  const params = [2026, 11];
  assert.equal(appendAlertOwnerFilter('', null, params), '');
  assert.deepEqual(params, [2026, 11]);
});
