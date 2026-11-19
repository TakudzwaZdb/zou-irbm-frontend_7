const MONTH_COUNT = 12;

export function parseReportingPeriods(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (parsed == null) return [];
  if (!Array.isArray(parsed)) throw new TypeError('Reporting milestones must be an array.');
  return parsed;
}

export function monthlyMilestoneDraft(value) {
  const periods = parseReportingPeriods(value);
  const draft = Array(MONTH_COUNT).fill('');
  const seen = new Set();
  for (const milestone of periods) {
    if (milestone?.periodType !== 'monthly') continue;
    const index = Number(milestone.periodIndex);
    if (!Number.isInteger(index) || index < 1 || index > MONTH_COUNT || seen.has(index)) {
      throw new TypeError('Monthly reporting milestones contain an invalid or duplicate month.');
    }
    seen.add(index);
    draft[index - 1] = String(milestone.expectedValue);
  }
  return draft;
}

export function withMonthlyMilestones(existing, monthlyValues) {
  if (!Array.isArray(monthlyValues) || monthlyValues.length !== MONTH_COUNT) {
    throw new TypeError('Exactly 12 monthly milestone values are required.');
  }
  const otherPeriods = parseReportingPeriods(existing).filter((milestone) => milestone?.periodType !== 'monthly');
  const monthlyPeriods = [];
  monthlyValues.forEach((value, index) => {
    if (value == null || String(value).trim() === '') return;
    const expectedValue = Number(value);
    if (!Number.isFinite(expectedValue)) {
      throw new TypeError(`The expected value for month ${index + 1} must be a finite number.`);
    }
    monthlyPeriods.push({ periodType: 'monthly', periodIndex: index + 1, expectedValue });
  });
  return [...otherPeriods, ...monthlyPeriods];
}
