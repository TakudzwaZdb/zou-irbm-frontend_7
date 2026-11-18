const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePerformanceAgainstTarget,
  calculateBaselineProgress,
  calculateProgressPace,
  calculateTargetVariance,
  calculateExpectedProgress,
  getReportingMilestone,
  classifyProgressVariance,
  classifyTargetPace,
  summarizeKpis,
  calculateWeightedKpiScore,
  calculateOverallSeniorManagerPerformance,
  classifyTargetPerformance,
} = require('../src/utils/performanceAgainstTarget');

test('higher and lower direction calculations ignore baseline and handle zero/negative values', () => {
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 100, measurement_direction: 'higher' }, 75),
    { performancePct: 75, achieved: false, status: 'calculated' },
  );
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 100, measurement_direction: 'lower' }, 80),
    { performancePct: 125, achieved: true, status: 'calculated' },
  );
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 0, measurement_direction: 'higher' }, -2),
    { performancePct: null, achieved: false, status: 'not_calculable' },
  );
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 0, measurement_direction: 'lower' }, -2),
    { performancePct: null, achieved: true, status: 'not_calculable' },
  );
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 5, measurement_direction: 'higher' }, null),
    { performancePct: null, achieved: null, status: 'missing' },
  );
  assert.deepEqual(
    calculatePerformanceAgainstTarget({ target: 0, achievement_rule: 'exact_target' }, 0),
    { performancePct: 100, achieved: true, status: 'calculated' },
  );
  assert.equal(
    calculatePerformanceAgainstTarget({
      baseline: -20, target: -10, measurement_direction: 'higher', achievement_rule: 'baseline_progress',
    }, -15).performancePct,
    50,
  );
});

test('baseline progress remains separate from target performance and supports descending targets', () => {
  const higherKpi = { baseline: 30, target: 100, measurement_direction: 'higher' };
  assert.equal(calculateBaselineProgress(higherKpi, 75), 64.28571428571429);
  assert.equal(calculatePerformanceAgainstTarget(higherKpi, 75).performancePct, 75);

  const lowerKpi = { baseline: 30, target: 10, measurement_direction: 'lower' };
  assert.equal(calculateBaselineProgress(lowerKpi, 20), 50);
  assert.equal(calculatePerformanceAgainstTarget(lowerKpi, 20).performancePct, 50);
  assert.equal(calculateBaselineProgress({ baseline: 5, target: 5 }, 4), null);
  assert.equal(calculateBaselineProgress({ baseline: 5, target: 5 }, 5), 100);
});

test('progress pace matches month-based progress variance and supports lower-is-better KPIs', () => {
  const higher = calculateProgressPace({ baseline: 0, target: 100 }, 49.6, 6);
  assert.equal(higher.actualProgressPct, 49.6);
  assert.equal(higher.expectedPacePct, 50);
  assert.ok(Math.abs(higher.variance + 0.4) < 1e-12);
  assert.equal(higher.flag, 'behind');
  assert.equal(higher.status, 'calculated');
  const lower = calculateProgressPace(
    { baseline: 30, target: 10, measurement_direction: 'lower' },
    20,
    6,
  );
  assert.equal(lower.actualProgressPct, 50);
  assert.equal(lower.expectedPacePct, 50);
  assert.equal(lower.variance, 0);
  assert.equal(lower.flag, 'on-pace');
  assert.equal(calculateProgressPace({ baseline: 0, target: 100 }, 50, null).status, 'not_calculable');
});

test('monitoring classifies pace gaps without turning missing actuals into zero', () => {
  assert.deepEqual(classifyProgressVariance(68, 80, 10, 25), { variance: -12, severity: 'amber' });
  assert.deepEqual(classifyProgressVariance(54, 80, 10, 25), { variance: -26, severity: 'red' });
  assert.deepEqual(classifyProgressVariance(72, 80, 10, 25), { variance: -8, severity: null });
  assert.deepEqual(classifyProgressVariance(null, 80, 10, 25), { variance: null, severity: null });
});

test('target performance compares with expected pace independently of baseline', () => {
  const performance = calculatePerformanceAgainstTarget({ baseline: 70, target: 100 }, 40).performancePct;
  assert.deepEqual(classifyTargetPace(performance, 50), { variance: -10, flag: 'attention' });
  assert.deepEqual(classifyTargetPace(45, 50), { variance: -5, flag: 'behind' });
  assert.deepEqual(classifyTargetPace(65, 50), { variance: 15, flag: 'ahead' });
  assert.deepEqual(classifyTargetPace(null, 50), { variance: null, flag: 'none' });
});

test('summary uses KPI weights and excludes missing actuals without counting them as zero', () => {
  const summary = summarizeKpis([
    { kpi: { target: 100, weight: 3 }, actual: 100 },
    { kpi: { target: 100, weight: 1 }, actual: 50 },
    { kpi: { target: 100, weight: 20 }, actual: null },
  ]);
  assert.equal(summary.totalKpis, 3);
  assert.equal(summary.achieved, 1);
  assert.equal(summary.approaching, 0);
  assert.equal(summary.offTrack, 1);
  assert.equal(summary.belowTarget, 1);
  assert.equal(summary.missingActual, 1);
  assert.equal(summary.averagePerformance, 87.5);
  assert.equal(summary.submissionCoveragePct, 66.7);
  assert.equal(summary.applicableWeight, 24);
  assert.equal(summary.approvedWeight, 4);
  assert.equal(summary.weightCoveragePct, 16.7);
  assert.equal(summary.status, 'approaching');
  assert.equal(summary.provisional, true);
});

test('summary classifies on-track, at-risk, and off-track KPIs while separating missing actuals', () => {
  const summary = summarizeKpis([
    { kpi: { target: 100, weight: 1 }, actual: 90 },
    { kpi: { target: 100, weight: 1 }, actual: 79 },
    { kpi: { target: 100, weight: 1 }, actual: null },
  ]);
  assert.equal(summary.achieved, 0);
  assert.equal(summary.approaching, 1);
  assert.equal(summary.belowTarget, 2);
  assert.equal(summary.offTrack, 1);
  assert.equal(summary.missingActual, 1);
  assert.equal(classifyTargetPerformance(100), 'achieved');
  assert.equal(classifyTargetPerformance(80), 'approaching');
  assert.equal(classifyTargetPerformance(79.9), 'below-target');
  assert.equal(classifyTargetPerformance(null), null);
});

test('weighted KPI and configurable 90/10 senior-manager scores use central helpers', () => {
  assert.deepEqual(
    calculateWeightedKpiScore({ target: 100, weight: 25, measurement_direction: 'higher' }, 80),
    { achievementScore: 80, weightedScore: 20, weight: 25, status: 'calculated' },
  );
  assert.equal(calculateOverallSeniorManagerPerformance(80, 100, { resultsDelivery: 90, budgetPerformance: 10 }), 82);
  assert.equal(calculateOverallSeniorManagerPerformance(84, 80, { resultsDelivery: 90, budgetPerformance: 10 }), 83.6);
  assert.equal(calculateOverallSeniorManagerPerformance(84, 80, { resultsDelivery: 70, budgetPerformance: 30 }), 82.8);
  assert.equal(calculateOverallSeniorManagerPerformance(null, 100, { resultsDelivery: 90, budgetPerformance: 10 }), null);
  assert.equal(calculateOverallSeniorManagerPerformance(84, 80), null);
});

test('approved formula examples, variances, and milestone expected progress are direction-aware', () => {
  const higher = { baseline: 60, target: 100, measurement_direction: 'higher', weight: 1 };
  assert.equal(calculatePerformanceAgainstTarget(higher, 80).performancePct, 80);
  assert.equal(calculateBaselineProgress(higher, 80), 50);
  assert.equal(calculateTargetVariance(higher, 80), -20);

  const lower = { baseline: 20, target: 10, measurement_direction: 'lower', weight: 1 };
  assert.ok(Math.abs(calculatePerformanceAgainstTarget(lower, 15).performancePct - (100 * 10 / 15)) < 1e-12);
  assert.equal(calculateBaselineProgress(lower, 15), 50);
  assert.equal(calculateTargetVariance(lower, 15), -5);

  const milestone = { periodType: 'quarterly', periodIndex: 2, expectedValue: 500 };
  const expected = calculateExpectedProgress(
    { baseline: 0, target: 1000, measurement_direction: 'higher' },
    450,
    milestone,
  );
  assert.equal(expected.expectedProgressPct, 50);
  assert.equal(expected.performanceAgainstExpectedPct, 90);
  assert.equal(expected.expectedVariance, -50);
  assert.equal(calculateExpectedProgress(
    { baseline: 60, target: 100, measurement_direction: 'higher' },
    90,
    { expectedValue: 80 },
  ).expectedProgressPct, 50);
  assert.equal(getReportingMilestone({ reporting_periods: JSON.stringify([milestone]) }, 'quarterly', 2).expectedValue, 500);

  const lowerExpected = calculateExpectedProgress(lower, 15, { expectedValue: 12 });
  assert.equal(lowerExpected.performanceAgainstExpectedPct, 80);
  assert.equal(lowerExpected.expectedVariance, -3);

  const periodSpecific = calculateExpectedProgress(
    { target: 1000, measurement_direction: 'higher', reporting_mode: 'period' },
    90,
    { expectedValue: 100 },
  );
  assert.equal(periodSpecific.expectedProgressPct, 100);
  assert.equal(periodSpecific.performanceAgainstExpectedPct, 90);
  assert.equal(periodSpecific.expectedVariance, -10);
});

test('non-calculable values and duplicate KPI records are not silently scored or counted twice', () => {
  const invalid = calculatePerformanceAgainstTarget({ target: 100 }, -1);
  assert.deepEqual(invalid, { performancePct: null, achieved: false, status: 'not_calculable' });
  assert.deepEqual(calculatePerformanceAgainstTarget({ target: 100 }, ' '), {
    performancePct: null, achieved: null, status: 'invalid',
  });

  const summary = summarizeKpis([
    { kpi: { id: 1, target: 100, weight: 50 }, actual: 100 },
    { kpi: { id: 1, target: 100, weight: 50 }, actual: 100 },
  ]);
  assert.equal(summary.totalKpis, 1);
  assert.equal(summary.averagePerformance, 100);
});

test('approved KPI weights aggregate to the expected weighted group score', () => {
  const summary = summarizeKpis([
    { kpi: { id: 11, target: 100, weight: 40 }, actual: 90 },
    { kpi: { id: 12, target: 100, weight: 35 }, actual: 80 },
    { kpi: { id: 13, target: 100, weight: 25 }, actual: 80 },
  ]);
  assert.equal(summary.averagePerformance, 84);
  assert.equal(summary.applicableWeight, 100);
  assert.equal(summary.scoredWeight, 100);
});
