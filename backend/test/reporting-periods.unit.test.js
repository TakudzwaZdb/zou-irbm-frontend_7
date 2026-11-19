const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isValidReportingPeriods } = require('../src/utils/reportingPeriods');

test('validates monthly and other reporting milestones with unique periods', () => {
  assert.equal(isValidReportingPeriods([
    { periodType: 'monthly', periodIndex: 12, expectedValue: 100 },
    { periodType: 'quarterly', periodIndex: 4, expectedValue: 100 },
  ]), true);
});

test('rejects invalid period types, indexes, duplicate periods, and nonnumeric milestones', () => {
  assert.equal(isValidReportingPeriods([{ periodType: 'monthly', periodIndex: 13, expectedValue: 100 }]), false);
  assert.equal(isValidReportingPeriods([{ periodType: 'monthly', periodIndex: 1, expectedValue: ' ' }]), false);
  assert.equal(isValidReportingPeriods([
    { periodType: 'monthly', periodIndex: 1, expectedValue: 10 },
    { periodType: 'monthly', periodIndex: 1, expectedValue: 20 },
  ]), false);
  assert.equal(isValidReportingPeriods([{ periodType: 'weekly', periodIndex: 1, expectedValue: 1 }]), false);
});
