// The `unitHeadId` convention used on OperationalPlan and UnitHeadAppraisal
// records — "the Unit Head of unit X" is `head-${unitId}`. Centralized here
// so the convention only needs to change in one place, not wherever it was
// copy-pasted.
export function unitHeadIdFor(unitId: string): string {
  return `head-${unitId}`;
}
