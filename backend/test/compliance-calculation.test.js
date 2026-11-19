const { test } = require('node:test');
const assert = require('node:assert/strict');
const { consecutiveProgressRedStreak, consecutivePerformanceStreak } = require('../src/utils/compliance');

const kpi = { baseline: 0, target: 100 };

test('red escalation counts only official, consecutive reporting months', () => {
  const rows = [
    { year: 2026, month: 4, status: 'submitted', value: 10 },
    { year: 2026, month: 3, status: 'approved', value: 20 },
    { year: 2026, month: 2, status: 'approved', value: 30 },
    { year: 2026, month: 1, status: 'approved', value: 40 },
  ];

  assert.equal(consecutiveProgressRedStreak(rows, kpi, 50), 3);
});

test('a missing reporting month breaks a red streak', () => {
  const rows = [
    { year: 2026, month: 4, status: 'approved', value: 10 },
    { year: 2026, month: 2, status: 'approved', value: 20 },
    { year: 2026, month: 1, status: 'approved', value: 30 },
  ];

  assert.equal(consecutiveProgressRedStreak(rows, kpi, 50), 1);
});

test('red threshold comparison uses unrounded progress', () => {
  const rows = [{ year: 2026, month: 4, status: 'approved', value: 49.6 }];

  assert.equal(consecutiveProgressRedStreak(rows, kpi, 50), 1);
});

test('an approved value remains official while its amendment is pending', () => {
  const rows = [
    { year: 2026, month: 4, status: 'submitted', approved_at: '2026-04-25T10:00:00Z', value: 20 },
    { year: 2026, month: 4, status: 'submitted', preview_value: 90 },
  ];

  assert.equal(consecutiveProgressRedStreak(rows, kpi, 50), 1);
});

test('lower-is-better compliance uses progress toward a lower target', () => {
  const lowerKpi = { baseline: 20, target: 10, measurement_direction: 'lower' };
  const behind = [{ year: 2026, month: 4, status: 'approved', value: 15 }];
  const achieved = [{ year: 2026, month: 4, status: 'approved', value: 10 }];

  assert.equal(consecutiveProgressRedStreak(behind, lowerKpi, 60), 1);
  assert.equal(consecutiveProgressRedStreak(achieved, lowerKpi, 60), 0);
});

test('target-performance escalations are calculated separately from baseline progress alerts', () => {
  const abovePerformanceThreshold = [{ year: 2026, month: 4, status: 'approved', value: 75 }];
  assert.equal(consecutiveProgressRedStreak(abovePerformanceThreshold, { baseline: 70, target: 100 }, 50), 1);
  assert.equal(consecutivePerformanceStreak(abovePerformanceThreshold, { baseline: 70, target: 100 }, 50), 0);

  const lowerKpi = { baseline: 30, target: 10, measurement_direction: 'lower' };
  assert.equal(consecutivePerformanceStreak(
    [{ year: 2026, month: 4, status: 'approved', value: 20 }],
    lowerKpi,
    60,
  ), 1);
  assert.equal(consecutivePerformanceStreak(
    [{ year: 2026, month: 4, status: 'approved', value: 10 }],
    lowerKpi,
    60,
  ), 0);
});
