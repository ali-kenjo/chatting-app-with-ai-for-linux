// What the desktop window may do, as plain functions (no Electron needed, so
// node:test checks them). The window only ever shows this app's own helper
// (http://127.0.0.1:<port>); everything else goes to the real browser.

// Google sign-in (Firebase) opens a popup on these hosts
const SIGN_IN_HOSTS = /^([a-z0-9-]+\.)*(google\.com|googleapis\.com|gstatic\.com|firebaseapp\.com)$/;

// What the page may ask the system for: the microphone and camera (voice
// mode, Follow my face), fullscreen, and copying text out
const PERMISSIONS = new Set(["media", "fullscreen", "clipboard-sanitized-write"]);

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const sameOrigin = (url, origin) => parse(url)?.origin === origin;

function permissionAllowed(permission, requestingUrl, origin) {
  return PERMISSIONS.has(permission) && sameOrigin(requestingUrl, origin);
}

// Clicking a link or window.open: "inside" (this window), "popup" (a sign-in
// window), "external" (the user's browser) or "deny"
function openAction(url, origin) {
  const u = parse(url);
  if (!u) return "deny";
  if (u.origin === origin) return "inside";
  if (u.protocol === "https:" && SIGN_IN_HOSTS.test(u.hostname)) return "popup";
  if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:") return "external";
  return "deny";
}

const navigationAllowed = (url, origin) => sameOrigin(url, origin);

// Chromium identifies itself as "Electron" and Google refuses to sign in there
const cleanUserAgent = (ua) => String(ua).replace(/\s*(Electron|friends)\/\S+/gi, "");

module.exports = { permissionAllowed, openAction, navigationAllowed, cleanUserAgent };
