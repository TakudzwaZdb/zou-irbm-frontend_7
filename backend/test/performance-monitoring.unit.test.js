const { test } = require('node:test');
const assert = require('node:assert/strict');
const { periodDueAt } = require('../src/utils/performanceMonitoring');

test('submission cutoff includes all configured days after the reporting month closes', () => {
  assert.equal(periodDueAt(2026, 2, 7).toISOString(), '2026-03-07T23:59:59.000Z');
  assert.equal(periodDueAt(2024, 2, 1).toISOString(), '2024-03-01T23:59:59.000Z');
  assert.equal(periodDueAt(2026, 12, 7).toISOString(), '2027-01-07T23:59:59.000Z');
});
