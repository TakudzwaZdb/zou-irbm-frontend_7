const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, requirePerm('view_audit'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const rows = db
    .prepare(
      `SELECT a.id, a.ts, a.action, a.entity, a.entity_id, a.detail, u.name AS user_name, u.title AS user_title
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`
    )
    .all(limit);
  res.json({ entries: rows });
});

module.exports = router;
