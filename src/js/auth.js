// ---------- Authentication & Google OAuth ----------
// Two ways to be signed in to Google:
// - Stay signed in (server/google.js): with an OAuth client of your own, the
//   helper keeps a refresh token in your keyring and hands this page fresh
//   access tokens; you sign in once.
// - Firebase sign-in: a popup gives this page an access token that lasts an
//   hour and is gone when the app closes.
// Scopes: Gmail, Calendar, Drive, Docs, Sheets, Slides, YouTube, Tasks.
// Firebase is loaded from Google only when sign-in is set up and needed, never at
// page load: the app starts offline, and in Private mode nothing contacts Google.
const FIREBASE = "https://www.gstatic.com/firebasejs/10.13.0";
let firebase = null; // { initializeApp, getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut }

async function loadFirebase() {
  if (firebase) return firebase;
  const [app, auth] = await Promise.all([import(`${FIREBASE}/firebase-app.js`), import(`${FIREBASE}/firebase-auth.js`)]);
  firebase = { initializeApp: app.initializeApp, ...auth };
  return firebase;
}

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/presentations.readonly",
  "https://www.googleapis.com/auth/gmail.compose", // drafts
  "https://www.googleapis.com/auth/youtube.readonly", // your channel's numbers, comments, search
  "https://www.googleapis.com/auth/tasks", // Google Tasks
];

let authInstance = null;
let provider = null;
let cachedAccessToken = null; // Stored in-memory ONLY
let currentUser = null;
let isSigningIn = false;
let setup = "unknown"; // "ready", "not-configured" (no Firebase config yet) or "private" (Private mode)
let kept = { configured: false, connected: false }; // Stay signed in (server/google.js)
let renewTimer = null;

const announce = () => document.dispatchEvent(new CustomEvent("friends:auth-changed", { detail: { user: currentUser, hasToken: !!cachedAccessToken } }));

// The sign-in Friends keeps: its account, and a fresh access token (renewed every half hour)
export async function loadKeptSignIn() {
  try {
    kept = await (await fetch("/api/google/status")).json();
  } catch {
    kept = { configured: false, connected: false };
  }
  document.dispatchEvent(new CustomEvent("friends:google-kept", { detail: kept }));
  clearInterval(renewTimer);
  if (!kept.connected) return false;
  try {
    const { accessToken } = await (await fetch("/api/google/token")).json();
    if (!accessToken) throw new Error("No token");
    cachedAccessToken = accessToken;
    const a = kept.account || {};
    currentUser = { displayName: a.name || a.email || "Google", email: a.email || "", photoURL: a.picture || "", kept: true };
    renewTimer = setInterval(loadKeptSignIn, 30 * 60 * 1000);
    announce();
    return true;
  } catch {
    return false;
  }
}

export const getKept = () => kept;

// Whether Google sign-in can work: see Settings → Connected Apps for the setup
export const getSetup = () => setup;

// Forget what was loaded, e.g. after a Firebase config was saved
export function resetAuth() {
  authInstance = null;
  provider = null;
  setup = "unknown";
}

export async function initAuth() {
  if (authInstance) return authInstance;
  try {
    const res = await fetch("/api/firebase-config");
    const firebaseConfig = await res.json();
    if (!firebaseConfig.apiKey) {
      setup = firebaseConfig.private ? "private" : "not-configured";
      document.dispatchEvent(new CustomEvent("friends:google-setup", { detail: { setup } }));
      return null;
    }
    setup = "ready";
    document.dispatchEvent(new CustomEvent("friends:google-setup", { detail: { setup } }));

    const { initializeApp, getAuth, GoogleAuthProvider, onAuthStateChanged } = await loadFirebase();
    const app = initializeApp(firebaseConfig);
    authInstance = getAuth(app);

    provider = new GoogleAuthProvider();
    for (const scope of SCOPES) {
      provider.addScope(scope);
    }
    provider.setCustomParameters({ prompt: "select_account" });

    onAuthStateChanged(authInstance, (user) => {
      if (currentUser?.kept) return; // signed in the lasting way; Firebase's state doesn't matter
      currentUser = user;
      if (!user) {
        cachedAccessToken = null;
      }
      announce();
    });

    return authInstance;
  } catch (err) {
    console.error("Failed to initialize auth:", err);
    return null;
  }
}

// Stay signed in: Google's page in a popup (it comes back to /api/google/callback);
// resolves once the helper has the sign-in, or when the popup is closed
function keptSignIn() {
  const popup = window.open("/api/google/signin", "friends-google", "width=520,height=700");
  if (!popup) return Promise.reject(Object.assign(new Error("The sign-in window was blocked."), { code: "auth/popup-blocked" }));
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let closedAt = 0;
    const timer = setInterval(async () => {
      if (popup.closed && !closedAt) closedAt = Date.now();
      const done = await loadKeptSignIn();
      if (done) {
        clearInterval(timer);
        return resolve({ user: currentUser, accessToken: cachedAccessToken });
      }
      // Closed without finishing (a moment's grace for the last request), or given up after 10 minutes
      if ((closedAt && Date.now() - closedAt > 3000) || Date.now() - started > 10 * 60 * 1000) {
        clearInterval(timer);
        reject(Object.assign(new Error("Sign-in was closed."), { code: "auth/popup-closed-by-user" }));
      }
    }, 1000);
  });
}

export async function googleSignIn() {
  if (isSigningIn) return null;
  if (kept.configured) {
    isSigningIn = true;
    try {
      return await keptSignIn();
    } finally {
      isSigningIn = false;
    }
  }
  await initAuth();
  if (!authInstance || !provider) {
    throw Object.assign(new Error("Google sign-in isn't set up."), { code: setup === "private" ? "friends/private" : "friends/not-configured" });
  }

  try {
    isSigningIn = true;
    const { signInWithPopup, GoogleAuthProvider } = await loadFirebase();
    const result = await signInWithPopup(authInstance, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Could not obtain access token from Google.");
    }
    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    document.dispatchEvent(new CustomEvent("friends:auth-changed", { detail: { user: currentUser, hasToken: true } }));
    return { user: currentUser, accessToken: cachedAccessToken };
  } catch (err) {
    console.error("Sign-in failed:", err);
    throw err;
  } finally {
    isSigningIn = false;
  }
}

export async function logout() {
  if (kept.connected) {
    await fetch("/api/google/disconnect", { method: "POST" }).catch(() => {});
    clearInterval(renewTimer);
    kept = { ...kept, connected: false, account: null };
  }
  if (authInstance) {
    await (await loadFirebase()).signOut(authInstance);
  }
  cachedAccessToken = null;
  currentUser = null;
  announce();
}

// The helper says the lasting sign-in finished (from the popup)
document.addEventListener("friends:google-connected", () => loadKeptSignIn());

export function getAccessToken() {
  return cachedAccessToken;
}

export function getCurrentUser() {
  return currentUser;
}

export function isConnected() {
  return !!currentUser && !!cachedAccessToken;
}
