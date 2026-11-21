const PENDING_CONFIGURATION_STATUSES = new Set(['draft', 'submitted', 'rejected']);

export function pendingKpisInScope(kpis, nodes, rootKey, selectedKey = rootKey) {
  if (!rootKey || !selectedKey) return [];
  const nodesByKey = new Map((nodes || []).map((node) => [node.key, node]));

  return (kpis || [])
    .filter((kpi) => PENDING_CONFIGURATION_STATUSES.has(kpi.lifecycle_status))
    .flatMap((kpi) => {
      const ownerKey = `${kpi.owner_type}:${kpi.owner_id}`;
      const owner = nodesByKey.get(ownerKey);
      if (!owner) return [];

      let node = owner;
      while (node) {
        if (node.key === selectedKey) return [{ ...kpi, owner }];
        node = node.parentKey ? nodesByKey.get(node.parentKey) : null;
      }
      return [];
    });
}
