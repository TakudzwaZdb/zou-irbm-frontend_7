// Real protection against losing typed-but-unsaved work to an interruption
// — a power cut, a crashed tab, a closed laptop lid — mid-entry, before
// anyone got to click Save. This does NOT change when data actually reaches
// the server: the explicit Save/Submit buttons elsewhere in the app are
// still what writes a real value into kpi_values/kpi_contributions/etc.
// (deliberately — a KPI's draft/submit/approve lifecycle depends on the
// user choosing when something is ready). What this adds is a second,
// local-only safety net underneath that: every field is also mirrored into
// localStorage — via the debounced writer below, once typing actually
// pauses, not on every keystroke — so it's durable on disk well before any
// network request would fire. If the tab reopens later and finds a draft
// newer than (and different from) what the server has, the field starts
// from that draft instead of silently discarding it. Saving for real (the
// explicit Save/Submit action) clears the draft, since the server now
// agrees.
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

// Mirrors the current in-progress value into localStorage — the actual
// write. Cheap (a single small localStorage write), but callers should
// almost always reach it through debounce() below rather than call this
// directly on every keystroke: the input's own on-screen value already
// updates instantly via React state regardless, so nothing about typing
// itself waits on this — only the local recovery copy underneath it does.
export function writeDraft(key, value) {
  try {
    if (value === '' || value == null) { localStorage.removeItem(storageKey(key)); return; }
    localStorage.setItem(storageKey(key), JSON.stringify({ value, savedAt: Date.now() }));
  } catch (_) { /* storage unavailable — nothing else in this app depends on it */ }
}

// Delays calling `fn` until `delay` ms have passed with no further calls —
// a fresh call restarts the timer, so it only actually fires once typing
// pauses (effectively "on key release", not mid-keystroke). Used to turn
// the draft mirror above from "every keystroke" into that — still local
// and still cheap, just not dozens of localStorage writes while someone is
// mid-word. The one honest tradeoff: a keystroke typed in the last `delay`
// ms before a genuine crash (a power cut, a killed tab) — rather than
// every prior one — could be what's missing from the restored draft; 500ms
// keeps that window small while still meaningfully cutting write volume.
export function debounce(fn, delay = 500) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delay);
  };
  // Fires `fn` immediately with the given args and cancels any pending
  // timer — not currently called anywhere (every Save/Submit action reads
  // straight from React state, never from the draft, so nothing needs to
  // force a pending draft write early) but kept available for a future
  // caller that does need one.
  debounced.flush = (...args) => {
    if (timer) { clearTimeout(timer); timer = null; }
    fn(...args);
  };
  return debounced;
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
