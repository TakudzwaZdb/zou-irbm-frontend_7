import assert from 'node:assert/strict';
import test from 'node:test';
import { complianceFilterParams } from '../src/lib/complianceFilters.js';

test('compliance requests share the selected reporting period and scope', () => {
  const period = { year: 2026, month: 11 };

  for (const ownerType of ['programme', 'sub', 'unit', 'employee']) {
    const params = complianceFilterParams(period, `${ownerType}:42`);
    assert.equal(params.get('year'), '2026');
    assert.equal(params.get('month'), '11');
    assert.equal(params.get('ownerType'), ownerType);
    assert.equal(params.get('ownerId'), '42');
  }
});

test('all-organisations scope omits owner filters but retains the reporting period', () => {
  const params = complianceFilterParams({ year: 2026, month: 11 }, '');

  assert.equal(params.get('year'), '2026');
  assert.equal(params.get('month'), '11');
  assert.equal(params.has('ownerType'), false);
  assert.equal(params.has('ownerId'), false);
});
