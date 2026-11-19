const PERIOD_LIMITS = {
  monthly: 12,
  quarterly: 4,
  biannual: 2,
  annual: 1,
};

function isValidReportingPeriods(periods) {
  if (!Array.isArray(periods)) return false;
  const seen = new Set();
  for (const milestone of periods) {
    if (!milestone || typeof milestone !== 'object') return false;
    const maximumIndex = PERIOD_LIMITS[milestone.periodType];
    const periodIndex = Number(milestone.periodIndex);
    const expectedValue = milestone.expectedValue;
    if (!maximumIndex
        || !Number.isInteger(periodIndex)
        || periodIndex < 1
        || periodIndex > maximumIndex
        || expectedValue == null
        || (typeof expectedValue !== 'number' && (typeof expectedValue !== 'string' || expectedValue.trim() === ''))
        || !Number.isFinite(Number(expectedValue))) return false;
    const key = `${milestone.periodType}:${periodIndex}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

module.exports = { isValidReportingPeriods };
