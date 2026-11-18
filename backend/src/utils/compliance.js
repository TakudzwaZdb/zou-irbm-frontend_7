const { calculateBaselineProgress } = require('./performanceAgainstTarget');

function consecutiveRedStreak(rows, kpi, ragAmber) {
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

    const actual = Number(row.override_value != null ? row.override_value : row.value);
    if (!Number.isFinite(actual)) break;
    const progress = calculateBaselineProgress(kpi, actual);
    if (progress == null) break;
    if (progress >= Number(ragAmber)) break;

    streak++;
    expectedPeriod = period - 1;
  }

  return streak;
}

module.exports = { consecutiveRedStreak };
