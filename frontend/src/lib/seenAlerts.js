// Which alerts (see lib/alerts.js) this account has already opened the
// bell and looked at, so the red badge only ever calls out something
// genuinely NEW to them — never a reason to hide an alert from the list
// itself. AlertsBell always renders every current alert in full, seen or
// not; this only decides whether the count on top of the bell icon lights
// up. Keyed per-account so signing in as someone else on the same browser
// never inherits (or clears) another person's seen state.
//
// A signature is `${alert.id}|${alert.message}`, not just the id — so if
// the SAME kind of alert on the SAME KPI recurs with different content
// (returned a second time with a new comment, say), it reads as new again
// even though the stable id repeats; re-opening the bell on an unchanged
// alert never brings its badge back.
const PREFIX = 'zou_alerts_seen_v1_';

function storageKey(userId) { return PREFIX + userId; }

export function readSeen(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (_) {
    return new Set();
  }
}

// Caps how many signatures are remembered so this can never grow without
// bound across a long-lived account — keeps only the most recently seen
// ones, which is all that's ever needed (an alert that's gone quiet for
// that long has either been resolved or long since stopped mattering).
const MAX_REMEMBERED = 500;

export function writeSeen(userId, seenSet) {
  try {
    const arr = Array.from(seenSet).slice(-MAX_REMEMBERED);
    localStorage.setItem(storageKey(userId), JSON.stringify(arr));
  } catch (_) { /* storage unavailable — the badge just won't remember across reloads */ }
}
