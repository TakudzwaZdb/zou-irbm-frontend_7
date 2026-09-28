// Thin wrapper around @azure/msal-node's confidential-client authorization
// code flow — this is what lets an account provisioned with
// auth_provider='azure' (see routes/org.js's POST /individuals) sign in via
// their organization's Microsoft Entra ID (Azure AD) account instead of a
// password this app never stores for them. See AZURE_SETUP.md for how to
// create the App Registration in the Azure Portal that supplies the three
// env vars below.
//
// Deliberately lazy/optional: a deployment that hasn't set up Entra ID yet
// (or doesn't want the feature at all) just never calls these — everything
// else in the app works exactly as before. isConfigured() lets routes/
// auth.js return a clear "not set up yet" response instead of a crash.
const msal = require('@azure/msal-node');

const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
// Must exactly match a "Web" platform redirect URI registered on the App
// Registration in the Azure Portal — see AZURE_SETUP.md. In production this
// is your backend's own public URL + /api/auth/azure/callback; in local dev
// it's normally http://localhost:<backend-port>/api/auth/azure/callback.
const AZURE_REDIRECT_URI = process.env.AZURE_REDIRECT_URI;
// Where to send the browser after a successful (or failed) Microsoft sign-in
// — the frontend's own origin. Defaults to '/' (relative), which is correct
// whenever Express serves the built frontend and the API from the same
// origin (see lib/api.js's comment) — set this explicitly for local dev,
// where the Vite dev server usually runs on a different port than the
// backend that Azure actually redirects back to.
const AZURE_POST_LOGIN_REDIRECT = process.env.AZURE_POST_LOGIN_REDIRECT || '/';

function isConfigured() {
  return !!(AZURE_TENANT_ID && AZURE_CLIENT_ID && AZURE_CLIENT_SECRET && AZURE_REDIRECT_URI);
}

let cca = null;
function client() {
  if (!isConfigured()) return null;
  if (!cca) {
    cca = new msal.ConfidentialClientApplication({
      auth: {
        clientId: AZURE_CLIENT_ID,
        // "Accounts in this organizational directory only" — a single
        // tenant's own Entra ID directory, matching "pre-approved emails
        // within your organization sign in via Microsoft" rather than any
        // Microsoft account anywhere.
        authority: `https://login.microsoftonline.com/${AZURE_TENANT_ID}`,
        clientSecret: AZURE_CLIENT_SECRET,
      },
    });
  }
  return cca;
}

const SCOPES = ['openid', 'profile', 'email'];

// Step 1: where to send the browser to actually sign in with Microsoft.
async function getAuthCodeUrl(state) {
  return client().getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri: AZURE_REDIRECT_URI,
    state,
  });
}

// Step 2: exchange the ?code=... Microsoft redirected back with for real
// tokens, and return just the claims routes/auth.js needs to match this
// person to an existing users row — never a raw token the caller has to
// re-parse.
async function acquireTokenByCode(code) {
  const result = await client().acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri: AZURE_REDIRECT_URI,
  });
  const claims = result.idTokenClaims || {};
  // preferred_username is normally the sign-in email for a work/school
  // account; `email` is sometimes present too depending on tenant config —
  // prefer whichever is actually an email-shaped string.
  const email = [claims.email, claims.preferred_username].find((v) => typeof v === 'string' && v.includes('@'));
  return {
    email: email ? email.toLowerCase() : null,
    oid: claims.oid || null,
    name: claims.name || null,
  };
}

module.exports = { isConfigured, getAuthCodeUrl, acquireTokenByCode, AZURE_POST_LOGIN_REDIRECT };
