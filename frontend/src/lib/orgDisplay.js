export function headPosition(entity, fallback = '') {
  const title = String(entity?.head_title || '').trim();
  if (title) return title;

  const head = String(entity?.head || '').trim();
  const separator = /\s+[—–]\s+/.exec(head);
  if (separator) return head.slice(separator.index + separator[0].length).trim() || fallback;

  return fallback;
}

export function employeePosition(employee) {
  return String(employee?.role_title || '').trim() || 'Employee';
}

export function orgNodeLabel(node, kind) {
  return kind === 'employee' ? employeePosition(node) : (node?.name || '');
}
