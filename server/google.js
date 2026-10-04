// Staying signed in to Google. Firebase's sign-in (auth.js) only hands the page
// an access token that lasts an hour and is gone when the app closes, so you'd
// sign in again every time. With an OAuth client of your own (a "Desktop app"
// client in your Firebase project's Google Cloud console: Settings → Connected
// Apps → Stay signed in), Friends signs in through Google once, keeps the
// refresh token in your system keyring, and gets new access tokens by itself.
//
// The flow: the page opens /api/google/start's address in a popup; Google sends
// you back to /api/google/callback with a code; the helper trades it (with PKCE)
// for tokens. Nothing goes anywhere but Google.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const keys = require("./keys");
const logger = require("./logger");

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/tasks",
];

const AUTH_URL = process.env.FRIENDS_GOOGLE_AUTH || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.FRIENDS_GOOGLE_TOKEN || "https://oauth2.googleapis.com/token";
const USERINFO_URL = process.env.FRIENDS_GOOGLE_USERINFO || "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

const file = path.join(dataDir, "google.json"); // { clientId, account: { email, name, picture } }
const SECRET = "google-client-secret";
const REFRESH = "google-refresh-token";

function load() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) || {};
  } catch {
    return {};
  }
}

const save = (data) => writeJson(file, data);

let access = null; // { token, expiresAt }
const pending = new Map(); // state → { verifier, redirect, at }

function status() {
  const s = load();
  const configured = Boolean(s.clientId && keys.getSecret(SECRET));
  const connected = configured && Boolean(keys.getSecret(REFRESH));
  return { configured, connected, clientId: s.clientId || "", account: connected ? s.account || null : null };
}

// What you paste from Google Cloud console: the client's ID and secret
function setClient({ clientId, clientSecret } = {}) {
  const id = String(clientId || "").trim();
  const secret = String(clientSecret || "").trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error("That client ID doesn't look right: it ends in .apps.googleusercontent.com.");
  if (secret.length < 10 && !keys.getSecret(SECRET)) throw new Error("Paste the client secret too.");
  const s = load();
  if (s.clientId && s.clientId !== id) forget(); // another client: sign in again
  save({ ...s, clientId: id });
  if (secret.length >= 10) keys.setSecret(SECRET, secret);
  return status();
}

function removeClient() {
  forget();
  keys.deleteSecret(SECRET);
  save({});
  return status();
}

function forget() {
  keys.deleteSecret(REFRESH);
  access = null;
  const s = load();
  delete s.account;
  save(s);
}

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// The address to open in the popup. origin: the page's own address (http://localhost:<port>)
function start(origin) {
  const s = load();
  if (!status().configured) throw new Error("Set up “Stay signed in” first (Settings → Connected Apps).");
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error("Staying signed in works when Friends is opened at localhost.");
  const state = b64url(crypto.randomBytes(18));
  const verifier = b64url(crypto.randomBytes(40));
  const redirect = `${origin}/api/google/callback`;
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60 * 1000) pending.delete(k);
  pending.set(state, { verifier, redirect, at: Date.now() });
  const params = new URLSearchParams({
    client_id: s.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // a refresh token, so it can stay signed in
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL}?${params}` };
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Couldn't reach Google. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error_description || data.error || `Google said no (${res.status}).`), { code: data.error });
  return data;
}

// Google sent you back with a code: trade it for tokens and keep the refresh token
async function finish({ code, state, error }) {
  if (error) throw new Error(error === "access_denied" ? "You didn't allow it, so nothing changed." : `Google said: ${error}`);
  const p = pending.get(state);
  pending.delete(state);
  if (!p) throw new Error("This sign-in link has expired. Start again from Friends.");
  const s = load();
  const data = await tokenRequest({ client_id: s.clientId, client_secret: keys.getSecret(SECRET), code, code_verifier: p.verifier, grant_type: "authorization_code", redirect_uri: p.redirect });
  if (!data.refresh_token) throw new Error("Google didn't give Friends a way to stay signed in. Remove Friends' access at myaccount.google.com/permissions and try again.");
  keys.setSecret(REFRESH, data.refresh_token);
  access = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  let account = null;
  try {
    const me = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access.token}` }, signal: AbortSignal.timeout(10000) }).then((r) => r.json());
    account = { email: me.email || "", name: me.name || "", picture: me.picture || "" };
  } catch {}
  save({ ...load(), account });
  return status();
}

// A valid access token (renewed with the refresh token when needed), or null when not signed in
async function token() {
  if (access && access.expiresAt - Date.now() > 2 * 60 * 1000) return access.token;
  const s = load();
  const refresh = keys.getSecret(REFRESH);
  if (!s.clientId || !refresh) return null;
  try {
    const data = await tokenRequest({ client_id: s.clientId, client_secret: keys.getSecret(SECRET), refresh_token: refresh, grant_type: "refresh_token" });
    access = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    return access.token;
  } catch (err) {
    // Revoked, or expired (an app still in "Testing" on Google's side expires them after 7 days)
    if (err.code === "invalid_grant") {
      logger.warn("Google sign-in expired or was revoked; sign in again.");
      forget();
      return null;
    }
    throw err;
  }
}

async function disconnect() {
  const refresh = keys.getSecret(REFRESH);
  if (refresh) fetch(`${REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => {});
  forget();
  return status();
}

// The small page Google's popup lands on
function callbackPage(ok, message) {
  const text = ok ? "You're signed in. This window closes by itself." : message;
  const safe = String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><meta charset="utf-8"><title>Friends</title><style>body{font:16px system-ui,sans-serif;background:#131314;color:#e3e3e3;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px}</style><p>${safe}</p>${ok ? "<script>setTimeout(() => window.close(), 1200)</script>" : ""}`;
}

module.exports = { SCOPES, status, setClient, removeClient, start, finish, token, disconnect, callbackPage };
