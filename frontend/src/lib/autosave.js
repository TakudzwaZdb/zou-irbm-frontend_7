// Real protection against losing typed-but-unsaved work to an interruption
// — a power cut, a crashed tab, a closed laptop lid — mid-entry, before
// anyone got to click Save. This does NOT change when data actually reaches
// the server: the explicit Save/Submit buttons elsewhere in the app are
// still what writes a real value into kpi_values/kpi_contributions/etc.
// (deliberately — a KPI's draft/submit/approve lifecycle depends on the
// user choosing when something is ready). What this adds is a second,
// local-only safety net underneath that: every keystroke is also mirrored,
// synchronously, into localStorage, so it's already durable on disk before
// any network request would even fire. If the tab reopens later and finds
// a draft newer than (and different from) what the server has, the field
// starts from that draft instead of silently discarding it — exactly the
// "power cut during typing" case. Saving for real (the explicit
// Save/Submit action) clears the draft, since the server now agrees.
const PREFIX = 'zou_draft_v1_';

function storageKey(key) { return PREFIX + key; }

// Reads back a saved draft for this key, or null if there isn't one / the
// browser's storage is unavailable (private browsing, a full quota, etc. —
// this feature degrades silently rather than ever blocking data entry).
export function readDraft(key) {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.value === 'string' ? parsed.value : null;
  } catch (_) {
    return null;
  }
}

// Mirrors the current in-progress value — called on every keystroke. Cheap
// (a single small localStorage write) and synchronous, so the draft is
// already on disk the instant it's typed, not after some debounce window
// that a power cut could still land inside.
export function writeDraft(key, value) {
  try {
    if (value === '' || value == null) { localStorage.removeItem(storageKey(key)); return; }
    localStorage.setItem(storageKey(key), JSON.stringify({ value, savedAt: Date.now() }));
  } catch (_) { /* storage unavailable — nothing else in this app depends on it */ }
}

// Called once a real save has actually gone through — the server now has
// this value, so the local safety-net copy is no longer needed.
export function clearDraft(key) {
  try { localStorage.removeItem(storageKey(key)); } catch (_) { /* noop */ }
}

// The one rule for whether a found draft is worth restoring: it exists, and
// it disagrees with what the server/loaded state currently shows. A draft
// that matches the live value isn't "unsaved work" — it's just what's
// already there, so restoring it would only produce a redundant banner.
export function draftDiffersFrom(draft, liveValue) {
  return draft != null && draft !== (liveValue == null ? '' : String(liveValue));
}
