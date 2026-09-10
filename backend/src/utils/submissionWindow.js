// The submission window: when a period's KPI/contribution figures may
// actually be SUBMITTED for review (draft entry itself is always allowed —
// this only ever gates the "submit for review" action). Admin-configurable
// (see routes/settings.js's submissionOpenDay/submissionCloseDay), with the
// same sensible defaults the app shipped with:
//   - Opens on the 25th of the reporting month itself (submissionOpenDay).
//   - Runs on-time through the last day of that month.
//   - Still ACCEPTED, but marked late, from the 1st through the 3rd of the
//     following month (submissionCloseDay) — a short grace window rather
//     than an outright block, since real submitters miss the exact
//     month-end by a day or two.
//   - Closed entirely after submissionCloseDay of the following month,
//     until the next reporting month's own window opens.
const db = require('../db');

function getSubmissionWindowSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('submissionOpenDay', 'submissionCloseDay')").all();
  const s = {};
  rows.forEach((r) => { s[r.key] = Number(r.value); });
  return {
    submissionOpenDay: Number.isFinite(s.submissionOpenDay) && s.submissionOpenDay >= 1 && s.submissionOpenDay <= 31 ? s.submissionOpenDay : 25,
    submissionCloseDay: Number.isFinite(s.submissionCloseDay) && s.submissionCloseDay >= 1 && s.submissionCloseDay <= 31 ? s.submissionCloseDay : 3,
  };
}

// SQLite datetime('now') strings, and this app's own generated dates, are
// UTC with no offset marker — treated as such explicitly throughout, same
// as routes/compliance.js's own parseUtc.
function parseUtc(s) { return s ? new Date(s.replace(' ', 'T') + 'Z') : null; }

// The three boundary instants for one reporting (year, month), given the
// admin's configured open/close days. `month` is 1-12.
function windowBoundsFor(year, month, settings) {
  const { submissionOpenDay, submissionCloseDay } = settings || getSubmissionWindowSettings();
  const opensAt = new Date(Date.UTC(year, month - 1, submissionOpenDay, 0, 0, 0));
  // Date.UTC's month arg is 0-based, so passing the 1-based `month` here
  // lands on day 0 of the FOLLOWING month, i.e. the last day of this one —
  // the same "day 0 of next month" trick routes/compliance.js already uses.
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  // Passing 1-based `month` as Date.UTC's (0-based) month arg here lands
  // one calendar month ahead of the reporting month — exactly "the
  // following month" — for the late-but-accepted grace window's own close.
  const closesAt = new Date(Date.UTC(year, month, submissionCloseDay, 23, 59, 59));
  return { opensAt, monthEnd, closesAt };
}

// Classifies a single instant (an actual submission time, or "now" for a
// live pre-check) against one reporting period's window.
//   not_open — before the window opens; nothing may be submitted yet.
//   open     — on-time, within the reporting month itself.
//   late     — after month-end but within the grace window; accepted, flagged.
//   closed   — after the grace window; nothing may be submitted any more.
function classify(year, month, at, settings) {
  const { opensAt, monthEnd, closesAt } = windowBoundsFor(year, month, settings);
  let status;
  if (at < opensAt) status = 'not_open';
  else if (at <= monthEnd) status = 'open';
  else if (at <= closesAt) status = 'late';
  else status = 'closed';
  return { status, late: status === 'late', allowed: status === 'open' || status === 'late', opensAt, monthEnd, closesAt };
}

// "Now", for a live pre-check — real wall-clock time in production, always.
// The automated test suite is the one exception: node:test spawns a real
// server process (see test/helpers.js) and needs to exercise every window
// state (not_open/open/late/closed) deterministically, which a real clock
// can't give it on demand. When (and only when) the server was started with
// ALLOW_TEST_CLOCK_OVERRIDE=1 — something only the test harness's env ever
// sets, never a real deployment's — an `X-Test-Now` request header may
// substitute a fixed instant. Any request without that header, or any
// server not started with that env var, always gets the real clock.
function resolveNow(req) {
  if (process.env.ALLOW_TEST_CLOCK_OVERRIDE === '1') {
    const header = req?.headers?.['x-test-now'];
    if (header) {
      const d = new Date(header);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return new Date();
}

// Live pre-check used by every submit route below — "can this be submitted
// right now?" — and by the frontend's own GET /kpis/submission-window so
// the UI can disable Submit before ever making the attempt, not just after
// a rejected request.
function checkSubmissionWindow(year, month, req) {
  const settings = getSubmissionWindowSettings();
  return { ...classify(year, month, resolveNow(req), settings), settings };
}

// The SAME resolved "now" (real clock, or a test's X-Test-Now — see
// resolveNow above), formatted the way SQLite's own datetime('now') already
// is ('YYYY-MM-DD HH:MM:SS', UTC, space-separated — see parseUtc). Every
// submit route below stamps its row's submitted_at with THIS instead of a
// literal datetime('now') in the SQL, so the moment a submission is judged
// against and the moment actually persisted for it are always the same
// instant — in production that's always the real clock either way, but it's
// what lets the test suite verify a submission recorded during the late
// window actually reads back `late: true` afterward, not just in the
// immediate response.
function nowSqlString(req) {
  return resolveNow(req).toISOString().slice(0, 19).replace('T', ' ');
}

// Was a SPECIFIC already-recorded submission (its own submitted_at) late,
// using today's window settings? (Settings are evaluated live, the same
// way routes/compliance.js's own late-cutoff settings already are — an
// admin's change applies uniformly rather than needing every historical
// row re-stamped.) Returns false for anything not yet submitted.
function wasLate(year, month, submittedAtStr) {
  const at = parseUtc(submittedAtStr);
  if (!at) return false;
  return classify(year, month, at, getSubmissionWindowSettings()).status === 'late';
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(d) { return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth() + 1]} ${d.getUTCFullYear()}`; }

// A plain-English reason for a blocked submit — used both in the 403 body
// and available to the frontend banner without re-deriving the wording.
function windowMessage(year, month, win) {
  const label = `${MONTH_NAMES[month]} ${year}`;
  if (win.status === 'not_open') return `Submissions for ${label} open on ${fmtDate(win.opensAt)}.`;
  if (win.status === 'closed') return `Submissions for ${label} closed on ${fmtDate(win.closesAt)}.`;
  return null;
}

module.exports = { getSubmissionWindowSettings, windowBoundsFor, checkSubmissionWindow, wasLate, windowMessage, fmtDate, MONTH_NAMES, nowSqlString };
