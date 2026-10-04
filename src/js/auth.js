// ---------- Authentication & Google OAuth ----------
// Client-side authentication using Firebase Auth and in-memory access token cache.
// Scopes: Gmail, Calendar, Drive, Docs, Sheets, Slides.
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
];

let authInstance = null;
let provider = null;
let cachedAccessToken = null; // Stored in-memory ONLY
let currentUser = null;
let isSigningIn = false;
let setup = "unknown"; // "ready", "not-configured" (no Firebase config yet) or "private" (Private mode)

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
      currentUser = user;
      if (!user) {
        cachedAccessToken = null;
      }
      document.dispatchEvent(new CustomEvent("friends:auth-changed", { detail: { user, hasToken: !!cachedAccessToken } }));
    });

    return authInstance;
  } catch (err) {
    console.error("Failed to initialize auth:", err);
    return null;
  }
}

export async function googleSignIn() {
  if (isSigningIn) return null;
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
  if (authInstance) {
    await (await loadFirebase()).signOut(authInstance);
  }
  cachedAccessToken = null;
  currentUser = null;
  document.dispatchEvent(new CustomEvent("friends:auth-changed", { detail: { user: null, hasToken: false } }));
}

export function getAccessToken() {
  return cachedAccessToken;
}

export function getCurrentUser() {
  return currentUser;
}

export function isConnected() {
  return !!currentUser && !!cachedAccessToken;
}
