// ---------- Workspace Client UI & Integrations ----------
import { getAccessToken, isConnected, googleSignIn, logout, getCurrentUser, initAuth, resetAuth, getSetup, loadKeptSignIn, getKept } from "./auth.js";
import { api } from "./api.js";
import { openSettings, closeSettings } from "./settings.js";
import { getSettings } from "./store.js";

// Custom confirmation dialog for Workspace mutations
let confirmModal = null;

function ensureConfirmModal() {
  if (confirmModal) return confirmModal;
  const el = document.createElement("div");
  el.className = "ws-modal-backdrop";
  el.hidden = true;
  el.innerHTML = `
    <div class="ws-modal" role="dialog" aria-modal="true" aria-labelledby="ws-modal-title">
      <div class="ws-modal-icon">
        <svg viewBox="0 0 24 24"><path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>
      </div>
      <div class="ws-modal-content">
        <h3 id="ws-modal-title">Confirm Action</h3>
        <p class="ws-modal-desc" id="ws-modal-desc"></p>
        <div class="ws-modal-details" id="ws-modal-details"></div>
      </div>
      <div class="ws-modal-actions">
        <button type="button" class="btn" id="ws-modal-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="ws-modal-confirm">Confirm & Proceed</button>
      </div>
    </div>
  `;
  document.body.append(el);
  confirmModal = el;
  return el;
}

export function promptConfirmation(summary, details = {}) {
  return new Promise((resolve) => {
    const modal = ensureConfirmModal();
    const desc = modal.querySelector("#ws-modal-desc");
    const detailsEl = modal.querySelector("#ws-modal-details");
    const cancelBtn = modal.querySelector("#ws-modal-cancel");
    const confirmBtn = modal.querySelector("#ws-modal-confirm");

    const isFile = details.type === "file";
    const isCloud = details.type === "cloud"; // Auto, Dynamic or Fastest wants to use the cloud AI
    desc.textContent = isFile ? `Allow the AI to ${summary}?` : summary;
    cancelBtn.textContent = isFile ? "Deny" : isCloud ? "Keep it local" : "Cancel";
    confirmBtn.textContent = isFile ? "Allow" : isCloud ? "Send to the cloud" : "Confirm & Proceed";
    modal.querySelector("#ws-modal-title").textContent = isCloud ? "Use the cloud AI?" : "Confirm Action";
    detailsEl.innerHTML = "";

    // The details come from the AI, so they're added as text, never as HTML
    const row = (label, value, strong = false) => {
      const el = document.createElement("div");
      el.className = "ws-detail-row";
      const name = document.createElement("span");
      name.textContent = label;
      const val = document.createElement(strong ? "strong" : "span");
      val.textContent = value || "";
      el.append(name, " ", val);
      detailsEl.append(el);
    };

    if (details.type === "cloud") {
      row("Why:", details.reason);
      row("Goes to:", details.name, true);
    } else if (details.type === "gmail") {
      row("To:", details.to, true);
      row("Subject:", details.subject, true);
      const body = document.createElement("div");
      body.className = "ws-detail-body";
      body.textContent = (details.body || "").slice(0, 300);
      detailsEl.append(body);
    } else if (details.type === "calendar") {
      if (details.summary) row("Event:", details.summary, true);
      if (details.start || details.end) row("Time:", `${details.start || ""} → ${details.end || ""}`);
      if (details.location) row("Location:", details.location);
    } else if (details.type === "app") {
      // A connected app (Settings → Connected Apps), with what the AI wants to send it
      row("App:", details.app, true);
      if (details.args && Object.keys(details.args).length) {
        const body = document.createElement("div");
        body.className = "ws-detail-body";
        body.textContent = JSON.stringify(details.args, null, 2).slice(0, 600);
        detailsEl.append(body);
      }
    } else if (details.type === "command") {
      // A command in builder mode (Settings → Builder)
      row("In:", details.cwd);
      const body = document.createElement("pre");
      body.className = "ws-detail-body ws-detail-command";
      body.textContent = details.command || "";
      detailsEl.append(body);
      if (details.reason) row("Why:", details.reason);
    }

    const cleanUp = (allowed) => {
      modal.hidden = true;
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      resolve(allowed);
    };

    cancelBtn.onclick = () => cleanUp(false);
    confirmBtn.onclick = () => cleanUp(true);
    modal.hidden = false;
  });
}

// Quick action shortcuts
function sendPrompt(text) {
  const input = document.getElementById("composer-input");
  const sendBtn = document.getElementById("send-btn");
  if (input && sendBtn) {
    input.value = text;
    input.dispatchEvent(new Event("input"));
    sendBtn.click();
  }
}

export async function quickCheckCalendar() {
  if (!isConnected()) {
    try {
      await googleSignIn();
    } catch {
      return;
    }
  }
  sendPrompt("What is on my Google Calendar for today and upcoming this week?");
}

export async function quickCheckGmail() {
  if (!isConnected()) {
    try {
      await googleSignIn();
    } catch {
      return;
    }
  }
  sendPrompt("Check my recent unread Gmail messages and summarize any important updates.");
}

export async function quickSearchDrive(term = "") {
  if (!isConnected()) {
    try {
      await googleSignIn();
    } catch {
      return;
    }
  }
  sendPrompt(term ? `Search my Google Drive for "${term}" and tell me what you find.` : "List my recent Google Drive documents, sheets, and presentations.");
}

export function quickSearchNews(topic = "") {
  sendPrompt(topic ? `What is the latest news regarding ${topic}?` : "Summarize the top breaking news stories today.");
}

export function quickSearchGitHub(query = "trending") {
  sendPrompt(`Search GitHub for ${query} repositories and summarize the top results.`);
}

function avatarImage(src, alt) {
  const img = document.createElement("img");
  img.src = src;
  img.alt = alt;
  img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover;";
  return img;
}

// Update UI with Auth State
function updateAuthUI(user, hasToken) {
  const sidebarAvatar = document.getElementById("user-avatar");
  const sidebarName = document.getElementById("user-name");
  const sidebarEmail = document.getElementById("user-email");
  const sidebarAuthBtn = document.getElementById("sidebar-auth-btn");

  const wsAvatar = document.getElementById("ws-account-avatar");
  const wsName = document.getElementById("ws-account-name");
  const wsEmail = document.getElementById("ws-account-email");
  const signinBtn = document.getElementById("gsi-signin-btn");
  const signoutBtn = document.getElementById("gsi-signout-btn");

  if (user && hasToken) {
    const displayName = user.displayName || user.email?.split("@")[0] || "User";
    const email = user.email || "";
    const initial = displayName.charAt(0).toUpperCase();

    if (sidebarAvatar) {
      if (user.photoURL) {
        sidebarAvatar.replaceChildren(avatarImage(user.photoURL, displayName));
      } else {
        sidebarAvatar.textContent = initial;
      }
    }
    if (sidebarName) sidebarName.textContent = displayName;
    if (sidebarEmail) sidebarEmail.textContent = email;
    if (sidebarAuthBtn) {
      sidebarAuthBtn.title = "Connected to Google Workspace";
      sidebarAuthBtn.classList.add("connected");
    }

    if (wsAvatar) {
      if (user.photoURL) {
        wsAvatar.replaceChildren(avatarImage(user.photoURL, displayName));
      } else {
        wsAvatar.textContent = initial;
      }
    }
    if (wsName) wsName.textContent = displayName;
    if (wsEmail) wsEmail.textContent = email;
    if (signinBtn) signinBtn.hidden = true;
    if (signoutBtn) signoutBtn.hidden = false;
  } else {
    // Signed out (or the access token is gone after a reload): nothing may look connected
    if (sidebarEmail) sidebarEmail.textContent = user ? "Google: sign in again" : "Google not connected";
    // Firebase's sign-in only lasts until the app closes: point to the lasting one
    if (wsEmail && user && !getKept().configured) wsEmail.title = "Set up “Stay signed in” below, so you don't have to sign in every time.";
    if (sidebarAuthBtn) {
      sidebarAuthBtn.title = "Connect Google Account";
      sidebarAuthBtn.classList.remove("connected");
    }
    if (wsAvatar) wsAvatar.textContent = "?";
    if (wsName) wsName.textContent = user ? user.displayName || user.email || "Signed out" : "Not connected";
    if (wsEmail) wsEmail.textContent = user ? "Sign in again to use Gmail, Calendar and Drive" : "Sign in to use Gmail, Calendar and Drive";

    if (signinBtn) signinBtn.hidden = false;
    if (signoutBtn) signoutBtn.hidden = true;
  }
}

// On load: the lasting sign-in when there is one (no sign-in needed); else Firebase's
loadKeptSignIn().then((signedIn) => signedIn || initAuth());

document.addEventListener("friends:auth-changed", (e) => {
  const { user, hasToken } = e.detail || {};
  updateAuthUI(user, hasToken);
});

// Why signing in didn't work, in words a person can act on (null: they closed the popup)
function signInProblem(err) {
  const code = err?.code || "";
  if (getSettings()?.privacy?.localOnly || code === "friends/private") return "Private mode is on, so Google sign-in is off. Turn it off in Settings → AI control.";
  if (code === "friends/not-configured") return "Google sign-in needs a one-time setup with a Firebase project of your own. Open \"Set up Google sign-in\" below.";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/unauthorized-domain") {
    return `Google sign-in isn't allowed from ${location.hostname} yet. In the Firebase console, open Authentication → Settings → Authorized domains and add "${location.hostname}", then try again.`;
  }
  if (code === "auth/popup-blocked") return "The browser blocked the sign-in window. Allow pop-ups for this page and try again.";
  if (code === "auth/network-request-failed") return "Couldn't reach Google. Check your internet connection.";
  return `Signing in didn't work: ${err?.message || "unknown error"}`;
}

async function signIn() {
  const errorEl = document.getElementById("gsi-error");
  if (errorEl) errorEl.hidden = true;
  try {
    await googleSignIn();
  } catch (err) {
    console.warn("Sign in cancelled or failed:", err);
    const message = signInProblem(err);
    if (!message || !errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    openSettings("integrations");
  }
}

// Sidebar Google sign-in button
document.getElementById("sidebar-auth-btn")?.addEventListener("click", () => {
  if (isConnected()) openSettings("integrations");
  else signIn();
});

// Settings Google Sign-In & Sign-Out
document.getElementById("gsi-signin-btn")?.addEventListener("click", signIn);

document.getElementById("gsi-signout-btn")?.addEventListener("click", async () => {
  try {
    await logout();
  } catch (err) {
    console.error("Logout failed:", err);
  }
});

// Settings test buttons
document.getElementById("test-cal-btn")?.addEventListener("click", () => {
  closeSettings();
  quickCheckCalendar();
});
document.getElementById("test-gmail-btn")?.addEventListener("click", () => {
  closeSettings();
  quickCheckGmail();
});
document.getElementById("test-drive-btn")?.addEventListener("click", () => {
  closeSettings();
  quickSearchDrive();
});
document.getElementById("test-github-btn")?.addEventListener("click", () => {
  closeSettings();
  quickSearchGitHub("trending");
});
document.getElementById("test-news-btn")?.addEventListener("click", () => {
  closeSettings();
  quickSearchNews();
});

// Workspace quick pill bar
document.getElementById("workspace-bar")?.addEventListener("click", (e) => {
  const pill = e.target.closest(".ws-pill");
  if (!pill) return;
  const app = pill.dataset.app;
  if (app === "calendar") quickCheckCalendar();
  else if (app === "gmail") quickCheckGmail();
  else if (app === "drive") quickSearchDrive();
  else if (app === "news") quickSearchNews();
  else if (app === "github") quickSearchGitHub();
});

// Voice Hero prompt chips
document.getElementById("hero-prompts")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".prompt-chip");
  if (!chip) return;
  const promptText = chip.dataset.prompt;
  if (promptText) sendPrompt(promptText);
});

// ----- Stay signed in (server/google.js): an OAuth client of your own -----
const keptBox = document.getElementById("gsi-kept");
const keptId = document.getElementById("gsi-kept-id");
const keptSecret = document.getElementById("gsi-kept-secret");
const keptStatus = document.getElementById("gsi-kept-status");
const keptRemove = document.getElementById("gsi-kept-remove");
const keptOrigin = document.getElementById("gsi-kept-origin");

function renderKept(k = getKept()) {
  if (k.private) {
    keptStatus.textContent = "Private mode is on, so Google sign-in is off.";
    keptStatus.className = "test-feedback";
    return;
  }
  keptRemove.hidden = !k.configured;
  if (document.activeElement !== keptId) keptId.value = k.clientId || "";
  keptSecret.placeholder = k.configured ? "Saved (type to replace)" : "GOCSPX-…";
  keptStatus.className = `test-feedback${k.connected ? " ok" : ""}`;
  keptStatus.textContent = k.connected
    ? `✓ Signed in as ${k.account?.email || "your account"}; it stays that way.`
    : k.configured
      ? "✓ Set up. Click “Sign in with Google” above (once)."
      : "Not set up: you sign in again each time Friends opens.";
}
keptOrigin.textContent = location.origin;
document.addEventListener("friends:google-kept", (e) => renderKept(e.detail));

document.getElementById("gsi-kept-save").addEventListener("click", async () => {
  keptStatus.className = "test-feedback";
  keptStatus.textContent = "Saving…";
  try {
    const res = await fetch("/api/google/client", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: keptId.value, clientSecret: keptSecret.value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Couldn't save.");
    keptSecret.value = "";
    await loadKeptSignIn();
    renderKept(data);
    if (!data.connected) await signIn();
  } catch (err) {
    keptStatus.textContent = `⚠️ ${err.message}`;
    keptStatus.className = "test-feedback error";
  }
});

keptRemove.addEventListener("click", async () => {
  await fetch("/api/google/client", { method: "DELETE" }).catch(() => {});
  await logout().catch(() => {});
  await loadKeptSignIn();
});
keptBox.addEventListener("toggle", () => keptBox.open && loadKeptSignIn());

// ----- Setting up Google sign-in (a Firebase project of your own) -----
const setupBox = document.getElementById("gsi-setup");
const setupText = document.getElementById("gsi-config");
const setupStatus = document.getElementById("gsi-config-status");
const setupSave = document.getElementById("gsi-config-save");
const setupRemove = document.getElementById("gsi-config-remove");

function renderSetup() {
  const state = getSetup();
  setupBox.dataset.state = state;
  if (state === "not-configured") setupBox.open = true;
  setupRemove.hidden = state !== "ready";
  setupStatus.className = "test-feedback";
  setupStatus.textContent =
    state === "ready" ? "✓ Set up. Click “Sign in with Google” above." : state === "private" ? "Private mode is on, so Google sign-in is off." : "Not set up yet.";
}

document.addEventListener("friends:google-setup", renderSetup);

setupSave?.addEventListener("click", async () => {
  setupSave.disabled = true;
  setupStatus.className = "test-feedback";
  setupStatus.textContent = "Saving…";
  try {
    await api.google.saveConfig(setupText.value);
    setupText.value = "";
    resetAuth();
    await initAuth();
    renderSetup();
    setupStatus.textContent = "✓ Saved. Now click “Sign in with Google”. If Google says the domain isn't allowed, add 127.0.0.1 and localhost under Authorized domains (step 3).";
    setupStatus.classList.add("ok");
    document.getElementById("gsi-error").hidden = true;
  } catch (err) {
    setupStatus.textContent = `⚠️ ${err.message}`;
    setupStatus.classList.add("error");
  } finally {
    setupSave.disabled = false;
  }
});

setupRemove?.addEventListener("click", async () => {
  await api.google.removeConfig().catch(() => {});
  resetAuth();
  await initAuth();
  renderSetup();
});
