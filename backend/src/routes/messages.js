// Internal messaging — a real, working "email system" used ACROSS every
// tier (Individual <-> Unit Head <-> Sub-programme Rep <-> Programme Head
// <-> Corporate Planning Unit <-> Executive <-> ICT Admin). There's no
// outbound SMTP/email-delivery service configured for this reference
// deployment (same reasoning as the admin-assisted password reset in
// routes/users.js — nowhere for a real external email to actually go), so
// this is the genuine, persisted answer: a real inbox, addressed by each
// account's real @zou.ac.zw email (see utils/email.js), with real
// read/unread state — not a simulated "sent!" toast.
//
// Deliberately NOT scope-restricted like the KPI/plan cascades — the whole
// point of "used across the tier" is that any signed-in account can message
// any other, regardless of where either of them sits in the org tree (an
// Individual can write straight to the Vice Chancellor, same as any other
// pair). What IS enforced server-side: you can only read a message you are
// actually a sender or recipient of, and every recipient id must be a real
// account.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Everyone a person could possibly message — real names/emails/roles, never
// permissions or scope_id (that's the ICT-admin-only /api/users view).
router.get('/directory', (req, res) => {
  const users = db.prepare('SELECT id, name, title, email, role FROM users WHERE id != ? ORDER BY role, name').all(req.user.id);
  res.json({ users });
});

router.get('/unread-count', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM message_recipients WHERE recipient_id = ? AND read_at IS NULL').get(req.user.id);
  res.json({ count: row.n });
});

// ?box=inbox (default) or ?box=sent.
router.get('/', (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'inbox';

  if (box === 'sent') {
    const messages = db.prepare(
      'SELECT id, subject, body, sent_at FROM messages WHERE sender_id = ? AND sender_deleted_at IS NULL ORDER BY sent_at DESC'
    ).all(req.user.id);
    if (messages.length) {
      const ids = messages.map((m) => m.id);
      const placeholders = ids.map(() => '?').join(', ');
      const recipientRows = db.prepare(
        `SELECT mr.message_id, u.id AS user_id, u.name, u.email, mr.read_at
         FROM message_recipients mr JOIN users u ON u.id = mr.recipient_id
         WHERE mr.message_id IN (${placeholders})`
      ).all(...ids);
      const byMsg = {};
      recipientRows.forEach((r) => {
        (byMsg[r.message_id] = byMsg[r.message_id] || []).push({ id: r.user_id, name: r.name, email: r.email, read: !!r.read_at });
      });
      messages.forEach((m) => { m.recipients = byMsg[m.id] || []; });
    }
    return res.json({ messages });
  }

  const messages = db.prepare(
    `SELECT m.id, m.subject, m.body, m.sent_at, mr.read_at,
            u.id AS sender_id, u.name AS sender_name, u.email AS sender_email, u.role AS sender_role
     FROM message_recipients mr
     JOIN messages m ON m.id = mr.message_id
     JOIN users u ON u.id = m.sender_id
     WHERE mr.recipient_id = ? AND mr.deleted_at IS NULL
     ORDER BY m.sent_at DESC`
  ).all(req.user.id);
  res.json({ messages });
});

router.post('/', (req, res) => {
  const { recipientIds, subject, body } = req.body || {};
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'Choose at least one recipient.' });
  }
  if (!subject || !subject.trim()) return res.status(400).json({ error: 'A subject is required.' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'A message body is required.' });

  const uniqueIds = [...new Set(recipientIds.map(Number))].filter((id) => Number.isInteger(id) && id !== req.user.id);
  if (uniqueIds.length === 0) return res.status(400).json({ error: 'Choose at least one recipient other than yourself.' });
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const validIds = db.prepare(`SELECT id FROM users WHERE id IN (${placeholders})`).all(...uniqueIds).map((r) => r.id);
  if (validIds.length !== uniqueIds.length) return res.status(400).json({ error: 'One or more recipients could not be found.' });

  const sendTxn = db.transaction(() => {
    const messageId = db.prepare('INSERT INTO messages (sender_id, subject, body) VALUES (?, ?, ?)')
      .run(req.user.id, subject.trim(), body.trim()).lastInsertRowid;
    const insertRecipient = db.prepare('INSERT INTO message_recipients (message_id, recipient_id) VALUES (?, ?)');
    validIds.forEach((id) => insertRecipient.run(messageId, id));
    return messageId;
  });
  const messageId = sendTxn();

  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'send_message', 'message', messageId, `"${subject.trim()}" sent to ${validIds.length} recipient(s).`
  );
  res.status(201).json({ id: messageId });
});

router.post('/:id/read', (req, res) => {
  const row = db.prepare('SELECT * FROM message_recipients WHERE message_id = ? AND recipient_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Message not found in your inbox.' });
  if (!row.read_at) db.prepare("UPDATE message_recipients SET read_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

// Deletes THIS caller's own copy of a message — from their Inbox if they're
// a recipient, or from their Sent if they're the sender — exactly like a
// real email client: the other side's copy is untouched (see db.js's
// migration note on why this is two separate soft-delete columns, not one
// hard DELETE). Once every participant has cleared their own copy — the
// sender AND every recipient — the underlying row has nothing left
// pointing at it and is purged outright, so deleted mail doesn't pile up
// forever once nobody can see it anyway.
router.delete('/:id', (req, res) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const isSender = message.sender_id === req.user.id;
  const recipientRow = db.prepare('SELECT * FROM message_recipients WHERE message_id = ? AND recipient_id = ?').get(message.id, req.user.id);
  if (!isSender && !recipientRow) return res.status(404).json({ error: 'Message not found in your mailbox.' });

  if (isSender) {
    if (!message.sender_deleted_at) db.prepare("UPDATE messages SET sender_deleted_at = datetime('now') WHERE id = ?").run(message.id);
  } else if (!recipientRow.deleted_at) {
    db.prepare("UPDATE message_recipients SET deleted_at = datetime('now') WHERE id = ?").run(recipientRow.id);
  }

  // Purge check: has EVERY participant now deleted their own copy?
  const fresh = db.prepare('SELECT sender_deleted_at FROM messages WHERE id = ?').get(message.id);
  const remainingRecipients = db.prepare('SELECT COUNT(*) AS n FROM message_recipients WHERE message_id = ? AND deleted_at IS NULL').get(message.id).n;
  if (fresh.sender_deleted_at && remainingRecipients === 0) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(message.id); // cascades message_recipients
  }

  res.json({ ok: true });
});

module.exports = router;
