function correctiveActionPermissionError(action, status, user) {
  const permissions = new Set(user.permissions);
  const canManage = permissions.has('manage_corrective_actions');
  const canApprove = permissions.has('approve_corrective_actions');
  const isResponsible = action.responsible_user_id === user.id;

  if (['approved', 'rejected'].includes(status)) {
    if (!canApprove) return 'You do not have permission to approve or reject corrective action plans.';
    if (action.created_by === user.id) return 'A corrective action plan must be reviewed by someone other than its creator.';
  }
  if (['draft', 'submitted'].includes(status) && !canManage) {
    return 'Only an authorised corrective-action manager may submit or revise this plan.';
  }
  if (['in_progress', 'completed'].includes(status) && !canManage && !isResponsible) {
    return 'Only the corrective action owner or an authorised manager may update this plan.';
  }
  return null;
}

module.exports = { correctiveActionPermissionError };
