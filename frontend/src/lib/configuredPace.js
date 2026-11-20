import { performanceScorePct, expectedValueForMonth } from './scope.js';
import { parseReportingPeriods } from './reportingPeriods.js';

function numericValue(value) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function endMonthForPeriod(periodType, periodIndex) {
  const index = Number(periodIndex);
  if (!Number.isInteger(index) || index < 1) return null;
  if (periodType === 'quarterly' && index <= 4) return index * 3;
  if (periodType === 'biannual' && index <= 2) return index * 6;
  if (periodType === 'annual' && index === 1) return 12;
  return null;
}

function findMilestone(kpi, periodType, periodIndex) {
  let periods;
  try {
    periods = parseReportingPeriods(kpi.reporting_periods);
  } catch {
    return { milestone: null, invalid: true };
  }

  const exact = periods.find((period) => (
    period?.periodType === periodType && Number(period.periodIndex) === Number(periodIndex)
  ));
  if (exact) return { milestone: exact, invalid: false, source: 'exact' };

  const month = endMonthForPeriod(periodType, periodIndex);
  if (month == null) return { milestone: null, invalid: false, source: null };
  const monthly = periods.find((period) => (
    period?.periodType === 'monthly' && Number(period.periodIndex) === month
  )) || null;
  if (monthly) {
    return { milestone: monthly, invalid: false, source: 'monthly' };
  }
  if (kpi?.achievement_rule === 'exact_target') {
    return { milestone: null, invalid: false, source: null };
  }
  return {
    milestone: { periodType, periodIndex, expectedValue: expectedValueForMonth(kpi, month) },
    invalid: false,
    source: 'automated',
  };
}

function rounded(value) {
  return value == null ? null : Math.round(value * 10) / 10;
}

export function configuredPaceForPeriod(kpiDetails, catalogKpis, periodType, periodIndex) {
  const catalogById = new Map((catalogKpis || []).map((kpi) => [kpi.id, kpi]));
  const entries = (kpiDetails || []).map((detail) => {
    const catalogKpi = catalogById.get(detail.id);
    const apiExpected = numericValue(detail.performanceExpectedPacePct);
    const configured = catalogKpi
      ? findMilestone(catalogKpi, periodType, periodIndex)
      : { milestone: null, invalid: false };
    const milestoneValue = numericValue(configured.milestone?.expectedValue);
    const useConfiguredValue = apiExpected == null && milestoneValue != null;
    const scoringKpi = useConfiguredValue && catalogKpi.reporting_mode === 'period'
      ? { ...catalogKpi, reporting_mode: 'cumulative', target: milestoneValue }
      : catalogKpi;
    const expected = apiExpected ?? (useConfiguredValue
      ? performanceScorePct(scoringKpi, milestoneValue)
      : null);
    const actual = useConfiguredValue && detail.actual != null
      ? performanceScorePct(scoringKpi, detail.actual)
      : numericValue(detail.performancePct);
    const variance = expected != null && actual != null ? expected - actual : null;
    const weightValue = detail.weight ?? catalogKpi?.weight;
    const rawWeight = numericValue(weightValue);
    const weight = weightValue == null ? 1 : rawWeight != null && rawWeight > 0 ? rawWeight : 0;
    const hasConfiguredMilestone = Boolean(configured.milestone);
    const paceFlag = variance == null ? 'none'
      : variance >= 10 ? 'attention'
        : variance > 0 ? 'behind'
          : variance <= -10 ? 'ahead' : 'on-pace';

    return {
      ...detail,
      performancePct: rounded(actual),
      performanceExpectedPacePct: rounded(expected),
      paceVariancePct: rounded(variance),
      paceVarianceRawPct: variance,
      paceFlag,
      target: useConfiguredValue && catalogKpi.reporting_mode === 'period'
        ? milestoneValue
        : detail.target,
      expectedPaceConfigured: apiExpected != null || hasConfiguredMilestone,
      expectedPaceInvalidSchedule: configured.invalid,
      expectedPaceUsesMonthlyFallback: useConfiguredValue && configured.source === 'monthly',
      paceExpectedRawPct: expected,
      pacePerformanceRawPct: actual,
      paceWeight: weight,
    };
  });

  const expectedEntries = entries.filter((entry) => (
    entry.paceExpectedRawPct != null && entry.paceWeight > 0
  ));
  const comparedEntries = expectedEntries.filter((entry) => (
    entry.pacePerformanceRawPct != null
  ));
  const weightedAverage = (items, valueFor) => {
    const totalWeight = items.reduce((sum, item) => sum + item.paceWeight, 0);
    if (!totalWeight) return null;
    return items.reduce((sum, item) => sum + valueFor(item) * item.paceWeight, 0) / totalWeight;
  };
  const averageVariance = weightedAverage(comparedEntries, (entry) => entry.paceVarianceRawPct);

  return {
    kpis: entries,
    summary: {
      expectedPacePct: rounded(weightedAverage(expectedEntries, (entry) => entry.paceExpectedRawPct)),
      averageComparedExpectedPacePct: rounded(weightedAverage(comparedEntries, (entry) => entry.paceExpectedRawPct)),
      averagePacePerformancePct: rounded(weightedAverage(comparedEntries, (entry) => entry.pacePerformanceRawPct)),
      averagePaceVariancePct: rounded(averageVariance),
      isBehindPace: averageVariance != null && averageVariance > 0,
      paceKpiCount: comparedEntries.length,
      behindPaceCount: comparedEntries.filter((entry) => entry.paceVarianceRawPct > 0).length,
      notConfiguredPaceCount: entries.filter((entry) => (
        !entry.expectedPaceConfigured && !entry.expectedPaceInvalidSchedule
      )).length,
      notCalculablePaceCount: entries.filter((entry) => (
        entry.expectedPaceConfigured && entry.performanceExpectedPacePct == null
      )).length,
      invalidScheduleCount: entries.filter((entry) => entry.expectedPaceInvalidSchedule).length,
      monthlyFallbackCount: entries.filter((entry) => entry.expectedPaceUsesMonthlyFallback).length,
    },
  };
}
