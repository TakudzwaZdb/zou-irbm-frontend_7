const express = require('express');
const db = require('../db');
const { requireAuth, requirePerm } = require('../middleware/auth');

const router = express.Router();

// Real cursor pagination, not just a bigger hard cap — the log only grows,
// and a single "first 1000 rows, forever" query (the old behavior) meant
// anything before that got permanently unreachable from the UI the moment
// the system had more than 1000 entries, no matter how it was filtered.
// `before` is the id of the oldest row already loaded — since rows are
// always walked newest-first, "give me the next page" means "everything
// with a smaller id than the last one I already have", which stays correct
// even if new entries are written concurrently between page loads (a new
// row always sorts before the cursor, never after it, so it can't get
// skipped or duplicated by paging further back in the same session).
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;
router.get('/', requireAuth, requirePerm('view_audit'), (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const before = req.query.before ? Number(req.query.before) : null;
  if (req.query.before && !Number.isFinite(before)) {
    return res.status(400).json({ error: 'before must be a numeric audit entry id.' });
  }

  const where = before ? 'WHERE a.id < ?' : '';
  const params = before ? [before, limit + 1] : [limit + 1];
  // Fetch one extra row purely to learn whether there's a next page,
  // without a separate COUNT(*) query — trimmed back off before responding.
  const rows = db
    .prepare(
      `SELECT a.id, a.ts, a.action, a.entity, a.entity_id, a.detail, u.name AS user_name, u.title AS user_title
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.id DESC LIMIT ?`
    )
    .all(...params);

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  res.json({ entries, hasMore, nextCursor: hasMore ? entries[entries.length - 1].id : null });
});

module.exports = router;
