import assert from 'node:assert/strict';
import test from 'node:test';
import { automatedMonthlyMilestones, monthlyMilestoneDraft, withMonthlyMilestones } from '../src/lib/reportingPeriods.js';

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

test('automatic monthly pace is direction-aware and preserves full precision', () => {
  const higher = automatedMonthlyMilestones({ baseline: 96.5, target: 99.5, measurement_direction: 'higher' });
  assert.equal(Number(higher[10]).toFixed(2), '99.25');

  const enrolment = automatedMonthlyMilestones({ baseline: 14200, target: 16000, measurement_direction: 'higher' });
  assert.equal(Number(enrolment[10]), 15850);

  const lower = automatedMonthlyMilestones({ baseline: 30, target: 10, measurement_direction: 'lower' });
  assert.equal(Number(lower[10]), 11.666666666666668);

  const exact = automatedMonthlyMilestones({ baseline: 55, target: 90, achievement_rule: 'exact_target' });
  assert.deepEqual(exact, Array(12).fill(''));
});
