function appendAlertOwnerFilter(ownerType, ownerId, params) {
  if (!ownerType) return '';
  if (ownerId == null) {
    params.push(ownerType);
    return ` AND k.owner_type = $${params.length}`;
  }
  if (ownerType === 'programme') {
    params.push(ownerId, ownerId);
    return ` AND ((k.owner_type = 'programme' AND k.owner_id = $${params.length - 1}) OR p.id = $${params.length})`;
  }

  const scopeColumns = { sub: 's.id', unit: 'u.id', employee: 'e.id' };
  const scopeColumn = scopeColumns[ownerType];
  if (!scopeColumn) throw new TypeError(`Unsupported performance-alert owner type: ${ownerType}`);
  params.push(ownerId);
  return ` AND ${scopeColumn} = $${params.length}`;
}

module.exports = { appendAlertOwnerFilter };
