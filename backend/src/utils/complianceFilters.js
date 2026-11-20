function matchesComplianceSub(sub, ownerType, ownerId, selectedSubId) {
  if (!ownerType) return true;
  if (ownerType === 'programme') return sub.programme_id === ownerId;
  return sub.id === selectedSubId;
}

module.exports = { matchesComplianceSub };
