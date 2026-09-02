const crypto = require('crypto');

// A cryptographically random, single-use temporary password for a freshly
// provisioned or admin-reset account — never a shared, guessable default
// (see SECURITY_REVIEW.md's finding #1). Callers pair this with
// users.must_change_password = 1 so the account can't be used for anything
// beyond signing in and choosing a real password of the holder's own.
// base64url keeps it safe to put straight into JSON/URLs; 12 random bytes
// -> 16 characters, comfortably past the 8-character minimum this app
// enforces everywhere a password is set.
function generateTempPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

module.exports = { generateTempPassword };
