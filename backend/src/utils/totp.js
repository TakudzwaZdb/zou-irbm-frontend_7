// A real, self-contained TOTP (RFC 6238) implementation — no external MFA
// service, no SMS/email dependency (this app has neither, see auth.js's own
// "forgot password" route), just the same HMAC-based algorithm every
// authenticator app (Google Authenticator, Authy, 1Password, etc.) already
// speaks. Built on node:crypto alone, so enabling MFA needs no new
// dependency and no outbound network call at all — the whole exchange is a
// shared secret plus wall-clock time.
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30; // standard TOTP time-step
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const last = bits.slice(bits.length - remainder).padEnd(5, '0');
    out += BASE32_ALPHABET[parseInt(last, 2)];
  }
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const val = BASE32_ALPHABET.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// A fresh random 20-byte (160-bit) secret — the same length Google
// Authenticator's own onboarding generates — base32-encoded for both
// storage and for the otpauth:// URI a QR code is built from.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
}

function totpAt(secretBase32, forTimeMs = Date.now()) {
  const counter = Math.floor(forTimeMs / 1000 / STEP_SECONDS);
  return hotp(secretBase32, counter);
}

// Accepts a code from the current 30s step or one step either side (±30s)
// to absorb ordinary clock drift between the server and the person's phone
// — the same tolerance window virtually every real TOTP verifier uses.
// Constant-time compares each candidate so a timing attack can't narrow
// down the right code digit by digit.
function verifyTotp(secretBase32, code, window = 1) {
  const candidate = String(code || '').trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const now = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const expected = totpAt(secretBase32, now + errorWindow * STEP_SECONDS * 1000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

function otpauthUrl({ secret, accountName, issuer = 'ZOU IRBM Strategic Plan Monitor' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, verifyTotp, otpauthUrl, base32Encode, base32Decode };
