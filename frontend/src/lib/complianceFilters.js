export function complianceFilterParams(period, orgFilter) {
  const params = new URLSearchParams({ year: String(period.year), month: String(period.month) });
  if (orgFilter) {
    const [ownerType, ownerId] = orgFilter.split(':');
    params.set('ownerType', ownerType);
    params.set('ownerId', ownerId);
  }
  return params;
}
