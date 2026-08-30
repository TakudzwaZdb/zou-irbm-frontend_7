// Notification tones for the internal messaging system — this app's real
// stand-in for email (see Messages.jsx: "the actual, working 'email system'
// for a deployment with no outbound SMTP configured"). Synthesized with the
// Web Audio API rather than shipped as an audio file, so there's nothing to
// fetch, nothing to bundle, and nothing that can 404. Two distinct tones:
// a short rising blip for "you sent something" (delivery) and a brighter
// two-note ring for "something arrived" (received) — different enough to
// tell apart by ear without looking at the screen.

const STORAGE_KEY = 'zou_sound_enabled';
let sharedCtx = null;

function getContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  // Browsers suspend a freshly-created AudioContext until a user gesture;
  // every call site here is already inside a click handler (Send, Sync…),
  // so resuming is safe and just clears that suspended state.
  if (sharedCtx.state === 'suspended') sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

export function isSoundEnabled() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  } catch (_) {
    return true;
  }
}

export function setSoundEnabled(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) { /* best-effort */ }
}

function beep(audioCtx, { freq, start, duration, gain = 0.09, type = 'sine' }) {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = audioCtx.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// kind: 'sent' (a message you composed was delivered) | 'received' (your
// unread count just went up since the last check).
export function playTone(kind) {
  if (!isSoundEnabled()) return;
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    if (kind === 'sent') {
      beep(audioCtx, { freq: 660, start: 0, duration: 0.14, gain: 0.07 });
      beep(audioCtx, { freq: 880, start: 0.07, duration: 0.12, gain: 0.07 });
    } else if (kind === 'received') {
      beep(audioCtx, { freq: 988, start: 0, duration: 0.16, gain: 0.1, type: 'triangle' });
      beep(audioCtx, { freq: 1319, start: 0.12, duration: 0.22, gain: 0.09, type: 'triangle' });
    }
  } catch (_) { /* a notification tone is a nicety — never let it break the app */ }
}
