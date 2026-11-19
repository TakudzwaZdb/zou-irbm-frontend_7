function numericValue(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isLowerBetter(kpi) {
  return kpi.measurement_direction === 'lower';
}

function targetReached(kpi, actual, target) {
  return isLowerBetter(kpi) ? actual <= target : actual >= target;
}

function result(performancePct, achieved, status) {
  return { performancePct, achieved, status };
}

function calculatePerformanceAgainstTarget(kpi, actual) {
  const target = numericValue(kpi.target);
  const value = numericValue(actual);
  if (actual == null) return result(null, null, 'missing');
  if (value == null || target == null) return result(null, null, 'invalid');

  const achieved = targetReached(kpi, value, target);
  const rule = kpi.achievement_rule || 'ratio';
  if (rule === 'exact_target') {
    return result(value === target ? 100 : 0, achieved, 'calculated');
  }
  if (rule === 'baseline_progress') {
    const progress = calculateBaselineProgress(kpi, value);
    return progress == null
      ? result(null, achieved, 'not_calculable')
      : result(progress, achieved, 'calculated');
  }
  if (rule !== 'ratio') return result(null, achieved, 'not_calculable');

  // Ratio scores are meaningful only for positive targets and non-negative
  // actuals. Special cases need an explicit approved rule, not a fallback.
  if (target <= 0 || value < 0 || (isLowerBetter(kpi) && value === 0)) {
    return result(null, achieved, 'not_calculable');
  }

  const performancePct = isLowerBetter(kpi)
    ? (target / value) * 100
    : (value / target) * 100;
  return Number.isFinite(performancePct)
    ? result(performancePct, achieved, 'calculated')
    : result(null, achieved, 'not_calculable');
}

function classifyTargetPerformance(performancePct) {
  if (!Number.isFinite(performancePct)) return null;
  return performancePct >= 100 ? 'achieved' : performancePct >= 80 ? 'approaching' : 'below-target';
}

function calculateBaselineProgress(kpi, actual) {
  const baseline = numericValue(kpi.baseline);
  const target = numericValue(kpi.target);
  const value = numericValue(actual);
  if (actual == null || value == null || baseline == null || target == null) return null;
  if (target === baseline) {
    return targetReached(kpi, value, target) ? 100 : null;
  }
  const progress = isLowerBetter(kpi)
    ? ((baseline - value) / (baseline - target)) * 100
    : ((value - baseline) / (target - baseline)) * 100;
  return Number.isFinite(progress) ? progress : null;
}

function calculateProgressPace(kpi, actual, asOfMonth) {
  const actualProgressPct = calculateBaselineProgress(kpi, actual);
  const month = numericValue(asOfMonth);
  if (actualProgressPct == null || month == null) {
    return {
      actualProgressPct: null,
      expectedPacePct: null,
      variance: null,
      flag: 'none',
      status: actual == null ? 'missing' : 'not_calculable',
    };
  }
  const expectedPacePct = (Math.max(0, Math.min(12, month)) / 12) * 100;
  return {
    actualProgressPct,
    expectedPacePct,
    ...classifyProgressPace(actualProgressPct, expectedPacePct),
    status: 'calculated',
  };
}

function calculatePerformancePace(kpi, actual, expectedValue) {
  const performance = calculatePerformanceAgainstTarget(kpi, actual);
  const expectedPerformance = expectedValue == null
    ? null
    : calculatePerformanceAgainstTarget(kpi, expectedValue);
  const expectedPacePct = expectedPerformance?.status === 'calculated'
    ? expectedPerformance.performancePct : null;
  if (expectedValue == null || expectedPacePct == null || performance.performancePct == null) {
    return {
      performancePct: performance.performancePct,
      expectedPacePct,
      variance: null,
      flag: 'none',
      status: expectedValue == null ? 'not_configured'
        : actual == null ? 'missing' : 'not_calculable',
    };
  }
  return {
    performancePct: performance.performancePct,
    expectedPacePct,
    ...classifyTargetPace(performance.performancePct, expectedPacePct),
    status: 'calculated',
  };
}

function calculateTargetVariance(kpi, actual) {
  const value = numericValue(actual);
  const target = numericValue(kpi.target);
  if (value == null || target == null) return null;
  return isLowerBetter(kpi) ? target - value : value - target;
}

function calculateExpectedProgress(kpi, actual, milestone) {
  const expectedValue = numericValue(milestone && milestone.expectedValue);
  const value = numericValue(actual);
  const periodSpecific = kpi.reporting_mode === 'period';
  const comparisonKpi = periodSpecific && expectedValue != null
    ? { ...kpi, target: expectedValue }
    : kpi;
  const target = numericValue(comparisonKpi.target);
  if (expectedValue == null || target == null) {
    return {
      expectedValue: expectedValue,
      expectedProgressPct: null,
      performanceAgainstExpectedPct: null,
      expectedVariance: null,
      status: milestone ? 'not_calculable' : 'not_configured',
    };
  }

  const expectedProgressPct = periodSpecific
    ? 100
    : calculateBaselineProgress(kpi, expectedValue);
  let performanceAgainstExpectedPct = null;
  if (periodSpecific && value != null) {
    performanceAgainstExpectedPct = calculatePerformanceAgainstTarget(comparisonKpi, value).performancePct;
  } else if (value != null && expectedValue > 0 && value >= 0) {
    if (isLowerBetter(kpi) && value > 0) performanceAgainstExpectedPct = (expectedValue / value) * 100;
    if (!isLowerBetter(kpi)) performanceAgainstExpectedPct = (value / expectedValue) * 100;
  }
  const expectedVariance = value == null
    ? null
    : isLowerBetter(kpi) ? expectedValue - value : value - expectedValue;
  return {
    expectedValue,
    expectedProgressPct: Number.isFinite(expectedProgressPct) ? expectedProgressPct : null,
    performanceAgainstExpectedPct: Number.isFinite(performanceAgainstExpectedPct) ? performanceAgainstExpectedPct : null,
    expectedVariance,
    status: expectedProgressPct == null
      ? 'not_calculable'
      : value == null ? 'missing_actual'
        : performanceAgainstExpectedPct == null ? 'not_calculable' : 'calculated',
  };
}

function getReportingMilestone(kpi, periodType, periodIndex) {
  let milestones;
  try {
    milestones = typeof kpi.reporting_periods === 'string'
      ? JSON.parse(kpi.reporting_periods)
      : kpi.reporting_periods;
  } catch {
    return null;
  }
  if (!Array.isArray(milestones)) return null;
  return milestones.find((milestone) =>
    milestone && milestone.periodType === periodType && Number(milestone.periodIndex) === Number(periodIndex)
  ) || null;
}

function classifyProgressVariance(progress, expectedProgress, warningGap, criticalGap) {
  if (!Number.isFinite(progress) || !Number.isFinite(expectedProgress)) return { variance: null, severity: null };
  const variance = progress - expectedProgress;
  const severity = variance <= -criticalGap ? 'red' : variance <= -warningGap ? 'amber' : null;
  return { variance, severity };
}

function classifyProgressPace(actualProgressPct, expectedPacePct) {
  if (!Number.isFinite(actualProgressPct) || !Number.isFinite(expectedPacePct)) {
    return { variance: null, flag: 'none' };
  }
  const variance = actualProgressPct - expectedPacePct;
  const flag = variance <= -10 ? 'attention'
    : variance < 0 ? 'behind'
      : variance >= 10 ? 'ahead' : 'on-pace';
  return { variance, flag };
}

function classifyTargetPace(performancePct, expectedPacePct) {
  if (!Number.isFinite(performancePct) || !Number.isFinite(expectedPacePct)) {
    return { variance: null, flag: 'none' };
  }
  const variance = expectedPacePct - performancePct;
  const flag = variance >= 10 ? 'attention'
    : variance > 0 ? 'behind'
      : variance <= -10 ? 'ahead' : 'on-pace';
  return { variance, flag };
}

function weightedPaceAverage(paces, valueFor) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const pace of paces) {
    const value = valueFor(pace);
    if (!Number.isFinite(value)) continue;
    const weight = pace.weight == null ? 1 : Number(pace.weight);
    if (!Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : null;
}

function summarizePace(paces) {
  const calculated = paces.filter((pace) => pace?.status === 'calculated');
  const expectedValues = paces.filter((pace) => Number.isFinite(pace?.expectedPacePct));
  const expectedPace = weightedPaceAverage(expectedValues, (pace) => pace.expectedPacePct);
  const averageComparedExpectedPace = weightedPaceAverage(calculated, (pace) => pace.expectedPacePct);
  const averagePerformance = weightedPaceAverage(calculated, (pace) => pace.performancePct);
  const averageVariance = weightedPaceAverage(calculated, (pace) => pace.variance);
  return {
    expectedPacePct: expectedPace == null ? null : Math.round(expectedPace * 10) / 10,
    averageComparedExpectedPacePct: averageComparedExpectedPace == null ? null : Math.round(averageComparedExpectedPace * 10) / 10,
    averagePacePerformancePct: averagePerformance == null ? null : Math.round(averagePerformance * 10) / 10,
    averagePaceVariancePct: averageVariance == null ? null : Math.round(averageVariance * 10) / 10,
    isBehindPace: averageVariance != null && averageVariance > 0,
    paceKpiCount: calculated.length,
    missingPaceCount: paces.filter((pace) => pace?.status === 'missing').length,
    notCalculablePaceCount: paces.filter((pace) => pace?.status === 'not_calculable').length,
    notConfiguredPaceCount: paces.filter((pace) => pace?.status === 'not_configured').length,
    behindPaceCount: calculated.filter((pace) => pace.flag === 'behind' || pace.flag === 'attention').length,
  };
}

function summarizeKpis(kpis) {
  const seenIds = new Set();
  const uniqueKpis = kpis.filter((item) => {
    if (item.kpi.id == null) return true;
    if (seenIds.has(item.kpi.id)) return false;
    seenIds.add(item.kpi.id);
    return true;
  });
  let achieved = 0;
  let approaching = 0;
  let belowTarget = 0;
  let offTrack = 0;
  let missingActual = 0;
  let weightedPerformance = 0;
  let scoredWeight = 0;
  let approvedSubmissions = 0;
  let pendingSubmissions = 0;
  let returnedSubmissions = 0;
  let missingSubmissions = 0;
  let submittedKpis = 0;
  let notCalculable = 0;
  let applicableWeight = 0;
  let applicableKpis = 0;
  let approvedWeight = 0;
  let invalidWeights = 0;

  for (const { kpi, actual, submissionStatus, returnComment, applicable = true } of uniqueKpis) {
    if (!applicable) continue;
    applicableKpis++;
    const weight = numericValue(kpi.weight);
    if (weight != null && weight >= 0) applicableWeight += weight;
    else invalidWeights++;
    if (submissionStatus === 'submitted') pendingSubmissions++;
    if (submissionStatus === 'draft' && returnComment) returnedSubmissions++;
    if (submissionStatus === 'submitted' || (actual != null && numericValue(actual) != null)) submittedKpis++;
    if (actual == null && submissionStatus !== 'submitted' && !(submissionStatus === 'draft' && returnComment)) missingSubmissions++;
    if (actual != null && numericValue(actual) != null) {
      approvedSubmissions++;
      if (weight != null && weight > 0) approvedWeight += weight;
    }
    const result = calculatePerformanceAgainstTarget(kpi, actual);
    if (actual == null || numericValue(actual) == null) {
      missingActual += 1;
      continue;
    }
    if (result.status !== 'calculated') {
      notCalculable++;
      continue;
    }

    const targetStatus = classifyTargetPerformance(result.performancePct);
    if (targetStatus === 'achieved') achieved += 1;
    else {
      belowTarget += 1;
      if (targetStatus === 'approaching') approaching += 1;
      else if (targetStatus === 'below-target') offTrack += 1;
    }

    if (result.performancePct != null) {
      if (!Number.isFinite(weight) || weight <= 0) continue;
      weightedPerformance += result.performancePct * weight;
      scoredWeight += weight;
    }
  }

  const averagePerformance = scoredWeight > 0 ? weightedPerformance / scoredWeight : null;
  const submissionCoveragePct = applicableKpis
    ? Math.round((approvedSubmissions / applicableKpis) * 1000) / 10
    : null;
  const status = averagePerformance == null
    ? applicableKpis ? notCalculable > 0 ? 'not-calculable' : pendingSubmissions > 0 ? 'pending' : 'missing' : 'no-kpis'
    : classifyTargetPerformance(averagePerformance);
  const provisionalReasons = [
    'Due-date applicability is not configured; coverage uses all active KPIs in scope.',
    'Approved organisational allocation weights are not applied to this roll-up.',
    'The approved rating matrix and budget-performance method are not configured.',
  ];
  if (submissionCoveragePct != null && submissionCoveragePct < 100) provisionalReasons.push('One or more applicable KPIs lack an approved actual.');
  if (notCalculable > 0) provisionalReasons.push('One or more approved actuals cannot be scored under their configured rule.');
  if (invalidWeights > 0) provisionalReasons.push('One or more KPI weights are invalid.');

  return {
    totalKpis: applicableKpis,
    applicableKpis,
    achieved,
    approaching,
    offTrack,
    belowTarget,
    missingActual,
    approvedSubmissions,
    pendingSubmissions,
    returnedSubmissions,
    notCalculable,
    invalidWeights,
    submittedKpis,
    missingSubmissions,
    submissionCoveragePct,
    applicableWeight,
    approvedWeight,
    scoredWeight,
    weightCoveragePct: applicableWeight > 0 ? Math.round((approvedWeight / applicableWeight) * 1000) / 10 : null,
    averagePerformance: averagePerformance == null ? null : Math.round(averagePerformance * 10) / 10,
    rawAveragePerformance: averagePerformance,
    status,
    provisional: true,
    provisionalReasons,
    coverageBasis: 'all_active_kpis_in_scope',
    aggregationBasis: 'unique_kpi_weights_only',
    budgetPerformance: null,
    overallPerformance: null,
    rating: null,
    ratingStatus: 'not_configured',
  };
}

function calculateWeightedKpiScore(kpi, actual, scoringCap) {
  const result = calculatePerformanceAgainstTarget(kpi, actual);
  if (result.performancePct == null) return { achievementScore: null, weightedScore: null, weight: null, status: result.status };
  if (scoringCap != null) {
    const capValue = numericValue(scoringCap);
    if (capValue == null || capValue <= 0) {
      return { achievementScore: null, weightedScore: null, weight: null, status: 'invalid_scoring_cap' };
    }
  }
  const cap = numericValue(scoringCap);
  const achievementScore = cap != null && cap > 0 ? Math.min(result.performancePct, cap) : result.performancePct;
  const weight = numericValue(kpi.weight);
  if (weight == null || weight < 0) return { achievementScore, weightedScore: null, weight: null, status: 'invalid_weight' };
  return {
    achievementScore,
    weightedScore: achievementScore * weight / 100,
    weight,
    status: 'calculated',
  };
}

function calculateOverallSeniorManagerPerformance(resultsDelivery, budgetPerformance, weights) {
  if (resultsDelivery == null || budgetPerformance == null || !weights) return null;
  const results = numericValue(resultsDelivery);
  const budget = numericValue(budgetPerformance);
  const resultsWeight = numericValue(weights.resultsDelivery);
  const budgetWeight = numericValue(weights.budgetPerformance);
  if (results == null || budget == null || resultsWeight == null || budgetWeight == null
      || resultsWeight < 0 || budgetWeight < 0 || resultsWeight + budgetWeight === 0) return null;
  return (results * resultsWeight + budget * budgetWeight) / (resultsWeight + budgetWeight);
}

module.exports = {
  calculatePerformanceAgainstTarget,
  classifyTargetPerformance,
  calculateBaselineProgress,
  calculateProgressPace,
  calculatePerformancePace,
  calculateTargetVariance,
  calculateExpectedProgress,
  getReportingMilestone,
  classifyProgressVariance,
  classifyTargetPace,
  summarizePace,
  summarizeKpis,
  calculateWeightedKpiScore,
  calculateOverallSeniorManagerPerformance,
};
