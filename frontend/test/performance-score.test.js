import assert from 'node:assert/strict';
import test from 'node:test';
import { performanceScorePct } from '../src/lib/scope.js';

test('ratio performance is scored against the KPI target, not its baseline progress', () => {
  assert.equal(performanceScorePct({ baseline: 70, target: 100 }, 64), 64);
});

test('lower-is-better performance reverses the target ratio', () => {
  assert.equal(performanceScorePct({ target: 10, measurement_direction: 'lower' }, 20), 50);
});

test('configured achievement rules are applied to performance previews', () => {
  assert.equal(performanceScorePct({ target: 5, achievement_rule: 'exact_target' }, 5), 100);
  assert.equal(performanceScorePct({ baseline: 0, target: 100, achievement_rule: 'baseline_progress' }, 40), 40);
});

test('period KPIs use their own selected-period milestone and no fallback target', () => {
  const kpi = {
    target: 100,
    reporting_mode: 'period',
    reporting_periods: [
      { periodType: 'monthly', periodIndex: 3, expectedValue: 20 },
    ],
  };

  assert.equal(performanceScorePct(kpi, 15, 'monthly', 3), 75);
  assert.equal(performanceScorePct(kpi, 15, 'monthly', 4), null);
});
