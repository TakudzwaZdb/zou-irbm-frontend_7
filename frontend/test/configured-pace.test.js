import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredPaceForPeriod } from '../src/lib/configuredPace.js';

function kpi(id, reportingPeriods, overrides = {}) {
  return {
    id,
    target: 100,
    baseline: 0,
    weight: 1,
    achievement_rule: 'ratio',
    reporting_mode: 'cumulative',
    reporting_periods: reportingPeriods,
    ...overrides,
  };
}

function detail(id, overrides = {}) {
  return {
    id,
    actual: 30,
    performancePct: 30,
    performanceExpectedPacePct: null,
    weight: 1,
    ...overrides,
  };
}

test('quarterly performance uses its explicit milestone before month-end fallback', () => {
  const configuredKpi = kpi(1, [
    { periodType: 'monthly', periodIndex: 3, expectedValue: 40 },
    { periodType: 'quarterly', periodIndex: 1, expectedValue: 50 },
  ]);
  const result = configuredPaceForPeriod(
    [detail(1)],
    [configuredKpi],
    'quarterly',
    1
  );

  assert.equal(result.kpis[0].performanceExpectedPacePct, 50);
  assert.equal(result.kpis[0].expectedPaceUsesMonthlyFallback, false);
  assert.equal(result.summary.expectedPacePct, 50);
});

test('quarterly performance falls back to the configured quarter-end monthly milestone', () => {
  const configuredKpi = kpi(1, [
    { periodType: 'monthly', periodIndex: 3, expectedValue: 40 },
  ]);
  const result = configuredPaceForPeriod(
    [detail(1)],
    [configuredKpi],
    'quarterly',
    1
  );

  assert.equal(result.kpis[0].performanceExpectedPacePct, 40);
  assert.equal(result.kpis[0].paceVariancePct, 10);
  assert.equal(result.kpis[0].paceFlag, 'attention');
  assert.equal(result.summary.monthlyFallbackCount, 1);
  assert.equal(result.summary.averagePaceVariancePct, 10);
});

test('period-specific KPIs compare actuals against the monthly fallback target', () => {
  const configuredKpi = kpi(1, [
    { periodType: 'monthly', periodIndex: 3, expectedValue: 40 },
  ], { reporting_mode: 'period' });
  const result = configuredPaceForPeriod(
    [detail(1, { actual: 30, performancePct: 30 })],
    [configuredKpi],
    'quarterly',
    1
  );

  assert.equal(result.kpis[0].target, 40);
  assert.equal(result.kpis[0].performanceExpectedPacePct, 100);
  assert.equal(result.kpis[0].performancePct, 75);
  assert.equal(result.kpis[0].paceVariancePct, 25);
});

test('annual performance uses December monthly milestone and reports invalid schedules', () => {
  const annualKpi = kpi(1, [{ periodType: 'monthly', periodIndex: 12, expectedValue: 100 }]);
  const invalidKpi = kpi(2, '{');
  const result = configuredPaceForPeriod(
    [detail(1), detail(2)],
    [annualKpi, invalidKpi],
    'annual',
    1
  );

  assert.equal(result.kpis[0].performanceExpectedPacePct, 100);
  assert.equal(result.summary.monthlyFallbackCount, 1);
  assert.equal(result.summary.invalidScheduleCount, 1);
  assert.equal(result.summary.notConfiguredPaceCount, 0);
});

test('pace is automated from baseline and target when no milestone is configured', () => {
  const automaticKpi = kpi(1, []);
  const result = configuredPaceForPeriod(
    [detail(1)],
    [automaticKpi],
    'quarterly',
    1
  );

  assert.equal(result.kpis[0].performanceExpectedPacePct, 25);
  assert.equal(result.kpis[0].expectedPaceUsesMonthlyFallback, false);
  assert.equal(result.kpis[0].expectedPaceConfigured, true);
  assert.equal(result.summary.notConfiguredPaceCount, 0);
});
