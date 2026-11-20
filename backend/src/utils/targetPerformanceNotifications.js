function targetPerformanceNotificationPlan(kpi, path, streak, settings, latestPeriod, institutionalRecipientId) {
  if (kpi.owner_type === 'employee' || streak <= 0 || !latestPeriod) return [];

  const startIndex = Number(latestPeriod.year) * 12 + Number(latestPeriod.month) - streak;
  const startYear = Math.floor(startIndex / 12);
  const startMonth = (startIndex % 12) + 1;
  const streakStart = `${startYear}-${String(startMonth).padStart(2, '0')}`;
  const detail = `${kpi.name} (${latestPeriod.year}-${String(latestPeriod.month).padStart(2, '0')}) has remained below the target-performance threshold for ${streak} consecutive reporting periods.`;
  const notifications = [];
  const programmeRecipients = [...new Set([
    path.employeeUserId,
    path.unitHeadUserId,
    path.repUserId,
    path.programmeHeadUserId,
  ].filter((id) => id != null))];

  if (streak >= settings.redEscalateProgramme && programmeRecipients.length) {
    notifications.push({
      recipientIds: programmeRecipients,
      notificationKey: `target-performance-${kpi.id}-${streakStart}-programme`,
      subject: `Programme-tier target-performance escalation: ${kpi.name}`,
      body: detail,
    });
  }
  if (streak >= settings.redEscalateVC && institutionalRecipientId != null) {
    notifications.push({
      recipientIds: [institutionalRecipientId],
      notificationKey: `target-performance-${kpi.id}-${streakStart}-institutional`,
      subject: `Institutional target-performance escalation: ${kpi.name}`,
      body: detail,
    });
  }

  return notifications;
}

module.exports = { targetPerformanceNotificationPlan };
