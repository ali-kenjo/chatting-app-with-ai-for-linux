// The desktop app's life outside its window: a tray icon (so it keeps running
// and reminders still come when the window is closed), starting when you log
// in, and notifications. Plain functions where possible, so node:test checks them.
const fs = require("fs");
const os = require("os");
const path = require("path");

// ~/.config/autostart/friends.desktop: the desktop starts Friends (in the tray) when you log in
const autostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "friends.desktop");

function autostartEntry(exec) {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Friends",
    "Comment=Your AI companion, in the tray",
    `Exec=${exec}`,
    "Icon=friends",
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

// Puts the entry there or takes it away; returns whether it's there now
function setAutostart(on, exec) {
  const file = autostartFile();
  try {
    const entry = autostartEntry(exec);
    const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (on && now !== entry) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, entry);
    } else if (!on && now !== null) {
      fs.rmSync(file, { force: true });
    }
  } catch {}
  return fs.existsSync(file);
}

// How to start this very program hidden: the installed one, or Electron with the app folder
function launchCommand({ execPath, appPath, packaged }) {
  const quote = (p) => (/[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p);
  return packaged ? `${quote(execPath)} --hidden` : `${quote(execPath)} ${quote(appPath)} --no-sandbox --hidden`;
}

// Where a click on a notification or tray item takes the page
function hashFor(action) {
  if (!action) return "";
  if (action.type === "open-chat" && /^[\w-]+$/.test(action.id || "")) return `#chat/${action.id}`;
  if (action.type === "reminder" || action.type === "today") return "#today";
  if (action.type === "voice") return "#voice";
  return "";
}

module.exports = { autostartFile, autostartEntry, setAutostart, launchCommand, hashFor };
