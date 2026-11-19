const { calculateBaselineProgress, calculatePerformanceAgainstTarget } = require('./performanceAgainstTarget');

function consecutiveStreak(rows, score, threshold) {
  const officialRows = rows
    .filter((row) =>
      (row.status === 'approved' || row.approved_at != null) &&
      (row.override_value != null || row.value != null)
    )
    .sort((a, b) => Number(b.year) - Number(a.year) || Number(b.month) - Number(a.month));

  let streak = 0;
  let expectedPeriod = null;
  for (const row of officialRows) {
    const period = Number(row.year) * 12 + Number(row.month);
    if (expectedPeriod != null && period !== expectedPeriod) break;

    const scorePct = score(row);
    if (scorePct == null) break;
    if (scorePct >= Number(threshold)) break;

    streak++;
    expectedPeriod = period - 1;
  }

  return streak;
}

function actualValue(row) {
  const actual = Number(row.override_value != null ? row.override_value : row.value);
  return Number.isFinite(actual) ? actual : null;
}

function consecutiveProgressRedStreak(rows, kpi, ragAmber) {
  return consecutiveStreak(rows, (row) => {
    const actual = actualValue(row);
    return actual == null ? null : calculateBaselineProgress(kpi, actual);
  }, ragAmber);
}

function consecutivePerformanceStreak(rows, kpi, performanceThreshold) {
  return consecutiveStreak(rows, (row) => {
    const actual = actualValue(row);
    return actual == null ? null : calculatePerformanceAgainstTarget(kpi, actual).performancePct;
  }, performanceThreshold);
}

module.exports = { consecutiveProgressRedStreak, consecutivePerformanceStreak };
