// ---------- Friends as a desktop app ----------
// The same page and helper as `npm start`, in their own window: the helper
// (server/server.js) runs inside this process on a fixed local port, so your
// chats, settings and keys are the very same ones the browser version uses
// (~/.config/friends). Nothing here is reachable from other computers.
const path = require("path");
const fs = require("fs");
const net = require("net");

const { app, BrowserWindow, Menu, session, shell, dialog } = require("electron");
const config = require("../server/config");
const policy = require("./policy");

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
  const { start } = require("../server/server");
  const server = start(port, HOST);
  await new Promise((resolve) => (server.listening ? resolve() : server.once("listening", resolve)));
  return `http://${HOST}:${server.address().port}`;
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
    fs.writeFileSync(stateFile(), JSON.stringify({ bounds, maximized: win.isMaximized() }));
  } catch {}
}

function createWindow() {
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
  win.once("ready-to-show", () => win.show());
  win.on("close", saveState);
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
      { label: "Friends", submenu: [{ role: "reload" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "quit" }] },
      { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "toggleDevTools" }] },
    ])
  );
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("window-all-closed", () => app.quit());

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
  createWindow();
  app.on("activate", () => !win && createWindow());
});
