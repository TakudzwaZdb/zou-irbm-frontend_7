// Thin, optional wrapper around nodemailer for the ONE thing this app
// currently sends real email for: handing a freshly admin-reset password
// straight to the account holder instead of relying on ICT admin to relay
// it by phone/in person. Deliberately narrow in scope — this is not a
// general notification system; routes/messages.js's internal inbox is
// still how every other kind of message moves between accounts, and stays
// that way (see its own header comment).
//
// Deliberately lazy/optional, same shape as utils/azureAuth.js: a
// deployment that hasn't configured a real SMTP relay yet (or doesn't want
// this feature at all) just never gets emails sent — routes/users.js's
// POST /:id/reset-password keeps working exactly as before, returning the
// new password once in the response for ICT admin to relay by hand.
// isEmailConfigured() lets that route decide whether to also attempt
// delivery, and sendPasswordResetEmail() never throws past this module —
// a delivery failure (bad credentials, relay down, network blip) is
// logged and reported back to the caller as { ok: false }, never allowed
// to turn a successful password reset into a failed API call.
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
// The address recipients see in "From" — falls back to SMTP_USER (the
// authenticating account) when not set separately, since most relays
// require the two to match or be from the same verified domain anyway.
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
// Most relays on 465 want implicit TLS; 587/25 want STARTTLS instead —
// nodemailer's `secure` option picks which. Defaults off unless the port
// is the classic implicit-TLS one, but can be forced either way.
const SMTP_SECURE = process.env.SMTP_SECURE != null
  ? process.env.SMTP_SECURE === 'true'
  : SMTP_PORT === 465;

function isEmailConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASSWORD && SMTP_FROM);
}

let transporter = null;
function client() {
  if (!isEmailConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
  }
  return transporter;
}

// Sends the one-time password directly to its owner. Returns { ok: true }
// on success or { ok: false, reason } on failure — never rejects/throws,
// so a caller can always fall back to "show it to the admin instead"
// without wrapping every call in its own try/catch.
async function sendPasswordResetEmail({ to, name, password }) {
  if (!isEmailConfigured()) return { ok: false, reason: 'not_configured' };
  try {
    await client().sendMail({
      from: SMTP_FROM,
      to,
      subject: 'Your ZOU IRBM Strategic Plan Monitor password has been reset',
      text:
        `Hello ${name},\n\n` +
        `An ICT Systems Administrator has reset your password for the ZOU IRBM Strategic Plan Monitor.\n\n` +
        `Your one-time password is:\n\n    ${password}\n\n` +
        `Sign in with this password and you'll immediately be asked to set a real one of your own — ` +
        `this one-time password will not work again afterward.\n\n` +
        `If you did not expect this, contact your ICT Systems Administrator right away.\n`,
      html:
        `<p>Hello ${name},</p>` +
        `<p>An ICT Systems Administrator has reset your password for the ZOU IRBM Strategic Plan Monitor.</p>` +
        `<p>Your one-time password is:</p>` +
        `<p style="font-size:16px;font-weight:600;font-family:monospace">${password}</p>` +
        `<p>Sign in with this password and you'll immediately be asked to set a real one of your own — ` +
        `this one-time password will not work again afterward.</p>` +
        `<p>If you did not expect this, contact your ICT Systems Administrator right away.</p>`,
    });
    return { ok: true };
  } catch (err) {
    console.error('sendPasswordResetEmail failed:', err.message);
    return { ok: false, reason: err.message };
  }
}

module.exports = { isEmailConfigured, sendPasswordResetEmail };
