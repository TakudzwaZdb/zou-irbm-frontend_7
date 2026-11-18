const db = require('../db');
const { sendPerformanceAlertEmail } = require('./mailer');

async function createPerformanceNotification({
  recipientId,
  alertId,
  escalationId = null,
  notificationKey,
  subject,
  body,
}) {
  const recipient = await db.prepare(
    'SELECT id, name, email FROM users WHERE id = ? AND deleted_at IS NULL'
  ).get(recipientId);
  if (!recipient) return false;
  const inserted = await db.prepare(
    `INSERT INTO performance_notifications
       (recipient_id, alert_id, escalation_id, notification_key, subject, body)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(recipient_id, notification_key) DO NOTHING
     RETURNING id`
  ).get(recipient.id, alertId, escalationId, notificationKey, subject, body);
  if (!inserted) return false;
  if (recipient.email) {
    const result = await sendPerformanceAlertEmail({ to: recipient.email, name: recipient.name, subject, body });
    if (!result.ok && result.reason !== 'not_configured') {
      console.error(`Performance alert email delivery failed for user ${recipient.id}: ${result.reason}`);
    }
  }
  return true;
}

module.exports = { createPerformanceNotification };
