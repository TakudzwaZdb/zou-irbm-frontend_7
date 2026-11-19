import assert from 'node:assert/strict';
import test from 'node:test';
import { monthlyMilestoneDraft, withMonthlyMilestones } from '../src/lib/reportingPeriods.js';

test('monthly milestone editor retains configured values and other reporting schedules', () => {
  const schedules = [
    { periodType: 'quarterly', periodIndex: 1, expectedValue: 25 },
    { periodType: 'monthly', periodIndex: 1, expectedValue: 10 },
    { periodType: 'monthly', periodIndex: 12, expectedValue: 100 },
  ];
  const draft = monthlyMilestoneDraft(JSON.stringify(schedules));

  assert.equal(draft.length, 12);
  assert.equal(draft[0], '10');
  assert.equal(draft[11], '100');
  assert.equal(draft[5], '');

  const updated = withMonthlyMilestones(schedules, draft);
  assert.deepEqual(updated, schedules);
});

test('blank monthly milestone values remain unconfigured', () => {
  const updated = withMonthlyMilestones([], ['10', '', '30', ...Array(9).fill('')]);
  assert.deepEqual(updated, [
    { periodType: 'monthly', periodIndex: 1, expectedValue: 10 },
    { periodType: 'monthly', periodIndex: 3, expectedValue: 30 },
  ]);
});

test('invalid or duplicate monthly schedules are reported', () => {
  assert.throws(() => monthlyMilestoneDraft([
    { periodType: 'monthly', periodIndex: 1, expectedValue: 10 },
    { periodType: 'monthly', periodIndex: 1, expectedValue: 20 },
  ]), /invalid or duplicate/);
  assert.throws(() => withMonthlyMilestones([], ['invalid', ...Array(11).fill('')]), /must be a finite number/);
});
