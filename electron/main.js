// ---------- Friends as a desktop app ----------
// The same page and helper as `npm start`, in their own window: the helper
// (server/server.js) runs inside this process on a fixed local port, so your
// chats, settings and keys are the very same ones the browser version uses
// (~/.config/friends). Nothing here is reachable from other computers.
const path = require("path");
const fs = require("fs");
const net = require("net");

const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, session, shell, dialog } = require("electron");
const config = require("../server/config");
const policy = require("./policy");
const desktop = require("./desktop");

const PREFERRED_PORT = 38417; // fixed, so the page's own saved state (its origin) stays the same
const HOST = "127.0.0.1";
const ICON = path.join(__dirname, "..", "build", "icon.png");

app.setName("Friends");
// Chromium's own files (cache, saved page state) live inside Friends' data folder, not next to it
app.setPath("userData", path.join(config.dataDir, "desktop"));

// Wayland natively when the session is one (X11 otherwise)
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
app.commandLine.appendSwitch("enable-features", "WaylandWindowDecorations");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let origin = "";
let tray = null;
let quitting = false;
// Started by the login autostart: stay in the tray until you open it
const startHidden = process.argv.includes("--hidden");

// ---------- The helper ----------
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

async function startHelper() {
  const port = (await portFree(PREFERRED_PORT)) ? PREFERRED_PORT : 0;
  const { start, setNativeNotify } = require("../server/server");
  const server = start(port, HOST);
  // Reminders and the morning briefing as the system's own notifications
  setNativeNotify(notify);
  await new Promise((resolve) => (server.listening ? resolve() : server.once("listening", resolve)));
  // The page is opened as "localhost" (the helper only listens on 127.0.0.1): Firebase accepts
  // localhost for Google sign-in in every project, but an IP address has to be added by hand
  return `http://localhost:${server.address().port}`;
}

// ---------- The window ----------
const stateFile = () => path.join(app.getPath("userData"), "window.json");

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.isMaximized() || win.isFullScreen() ? loadState().bounds : win.getBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify({ ...loadState(), bounds, maximized: win.isMaximized() }));
  } catch {}
}

function createWindow({ show = true } = {}) {
  const state = loadState();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    ...(state.bounds || {}),
    show: false,
    title: "Friends",
    icon: ICON,
    backgroundColor: "#131314",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => show && win.show());
  win.on("close", (e) => {
    saveState();
    // With the tray, closing the window keeps Friends running (reminders still come)
    if (!quitting && tray && keepInTray()) {
      e.preventDefault();
      // A voice conversation ends with the window: nobody can see it, and the microphone stays open otherwise
      win.webContents.executeJavaScript("document.dispatchEvent(new Event('friends:window-hidden'))").catch(() => {});
      win.hide();
      // Once: say where it went (on some desktops the tray icon isn't shown)
      const state = loadState();
      if (!state.toldTray) {
        notify({ title: "Friends is still running", body: "So your reminders still come. Open it again from the app menu or the tray; quit with Ctrl+Q or the tray's Quit." });
        try {
          fs.writeFileSync(stateFile(), JSON.stringify({ ...state, toldTray: true }));
        } catch {}
      }
    }
  });
  win.on("closed", () => (win = null));
  win.loadURL(origin);

  // Only the helper's own pages load here; links go to the browser, sign-in gets a popup
  win.webContents.on("will-navigate", (e, url) => {
    if (policy.navigationAllowed(url, origin)) return;
    e.preventDefault();
    if (policy.openAction(url, origin) === "external") shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const action = policy.openAction(url, origin);
    if (action === "external") shell.openExternal(url);
    if (action === "popup") return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 700, autoHideMenuBar: true, parent: win } };
    return { action: action === "inside" ? "allow" : "deny" };
  });
}

function setUpSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(policy.cleanUserAgent(ses.getUserAgent()));
  // The microphone and camera for this app's own page only (voice mode, Follow my face)
  ses.setPermissionRequestHandler((wc, permission, callback, details) => callback(policy.permissionAllowed(permission, details.requestingUrl || wc.getURL(), origin)));
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) => policy.permissionAllowed(permission, requestingOrigin, origin));
}

function setUpMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Friends", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { label: "Quit", accelerator: "CmdOrCtrl+Q", click: () => ((quitting = true), app.quit()) }] },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] },
    ])
  );
}

// ---------- Tray, autostart and notifications ----------
const settings = () => require("../server/settings").get();
const keepInTray = () => settings().desktop?.tray !== false;

// Shows the window (making it again if needed) and, with an action, goes there
function showWindow(action) {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  const hash = desktop.hashFor(action);
  if (hash) win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(hash)}`).catch(() => {});
}

function notify({ title, body, action }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON, silent: false });
  n.on("click", () => showWindow(action));
  n.show();
}

function trayMenu() {
  const s = settings();
  return Menu.buildFromTemplate([
    { label: "Open Friends", click: () => showWindow() },
    { label: "Voice conversation", click: () => showWindow({ type: "voice" }) },
    { label: "Today", click: () => showWindow({ type: "today" }) },
    { type: "separator" },
    { label: "Keep running in the tray", type: "checkbox", checked: s.desktop?.tray !== false, click: (item) => setDesktop({ tray: item.checked }) },
    { label: "Start when I log in", type: "checkbox", checked: s.desktop?.autostart === true, click: (item) => setDesktop({ autostart: item.checked }) },
    { type: "separator" },
    { label: "Quit Friends", click: () => ((quitting = true), app.quit()) },
  ]);
}

function setDesktop(changes) {
  const store = require("../server/settings");
  const s = store.get();
  store.set({ ...s, desktop: { ...s.desktop, ...changes } });
}

function setUpTray() {
  try {
    const icon = nativeImage.createFromPath(ICON).resize({ width: 22, height: 22 });
    tray = new Tray(icon);
    tray.setToolTip("Friends");
    tray.setContextMenu(trayMenu());
    tray.on("click", () => showWindow());
  } catch {
    tray = null; // no tray on this desktop: closing the window quits, as before
  }
}

// Settings → Characters → Daily life (or the tray menu) changed the desktop options
function applyDesktop(s) {
  desktop.setAutostart(s.desktop?.autostart === true, desktop.launchCommand({ execPath: process.execPath, appPath: app.getAppPath(), packaged: app.isPackaged }));
  tray?.setContextMenu(trayMenu());
}

app.on("second-instance", () => showWindow());

app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => {
  if (!tray || !keepInTray()) app.quit();
});

app.whenReady().then(async () => {
  try {
    origin = await startHelper();
  } catch (err) {
    dialog.showErrorBox("Friends couldn't start", String(err?.message || err));
    app.exit(1);
    return;
  }
  setUpSession();
  setUpMenu();
  setUpTray();
  applyDesktop(settings());
  require("../server/settings").onChange(applyDesktop);
  // From the login autostart it waits in the tray (unless there's no tray to wait in)
  createWindow({ show: !(startHidden && tray) });
  app.on("activate", () => (win ? showWindow() : createWindow()));
});
