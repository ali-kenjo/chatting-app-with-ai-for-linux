// `npm run doctor`: checks that this computer is ready to run Friends and says
// how to fix what isn't. Nothing is changed and nothing leaves this computer
// (it only asks 127.0.0.1).
const fs = require("fs");
const net = require("net");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tty = process.stdout.isTTY;
const paint = (code, text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
let errors = 0;
let warnings = 0;

const ok = (text) => console.log(`${paint(32, "✓")} ${text}`);
const warn = (text, fix) => (warnings++, console.log(`${paint(33, "!")} ${text}${fix ? `\n    → ${fix}` : ""}`));
const fail = (text, fix) => (errors++, console.log(`${paint(31, "✗")} ${text}${fix ? `\n    → ${fix}` : ""}`));

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer().once("error", () => resolve(false)).once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function main() {
  console.log(paint(1, `Friends ${pkg.version}: checking this computer\n`));

  // Node
  const need = Number((pkg.engines?.node || ">=20").match(/\d+/)[0]);
  const have = Number(process.versions.node.split(".")[0]);
  if (have >= need) ok(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} is too old (needs ${need} or newer)`, "Install a current Node.js: https://nodejs.org or `nvm install --lts`");

  // Dependencies
  const missing = Object.keys(pkg.dependencies || {}).filter((d) => !fs.existsSync(path.join(root, "node_modules", d, "package.json")));
  if (!missing.length) ok("Dependencies are installed");
  else fail(`Dependencies are missing (${missing.slice(0, 4).join(", ")}${missing.length > 4 ? "…" : ""})`, "Run: npm ci");

  // Data folder
  const config = require("../server/config");
  const storage = config.checkStorage();
  if (storage.ok) ok(`Your data is kept in ${storage.path}`);
  else fail(`Can't write to ${storage.path}: ${storage.error}`, "Set FRIENDS_DATA_DIR to a folder you can write to");

  // Backups
  const backups = require("../server/backup").list();
  if (backups.length) {
    const days = Math.floor((Date.now() - backups[0].createdAt) / 86400000);
    if (days <= 2) ok(`Your data is backed up (${backups.length} backup${backups.length === 1 ? "" : "s"}, the newest ${days ? `${days} day${days === 1 ? "" : "s"} ago` : "today"})`);
    else warn(`The newest backup is ${days} days old`, "Back up now: npm run backup (or Settings → Data & backups)");
  } else console.log(`${paint(2, "·")} No backups yet: Friends makes one a day while it runs, or run: npm run backup`);

  // API keys
  const keys = require("../server/keys");
  if (keys.isSystemKeyringOperational()) ok("API keys are kept in the system keyring");
  else warn("No system keyring: API keys go into a private file (mode 0600) in your data folder", "Optional: install GNOME Keyring or KWallet. Not needed for local AI, which has no key");

  // The port
  const port = config.port;
  const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  if (running) ok(`Friends is already running at http://localhost:${port}`);
  else if (await portFree(port)) ok(`Port ${port} is free (start it with: npm start)`);
  else fail(`Port ${port} is used by something else`, `Start Friends on another port: PORT=3001 npm start`);

  // Local AI
  const detected = await require("../server/local").detect();
  const found = detected.filter((s) => s.running);
  if (found.length) {
    for (const s of found) ok(`${s.label} is running with ${s.models.length} model${s.models.length === 1 ? "" : "s"}${s.models.length ? ` (${s.models.slice(0, 3).join(", ")}${s.models.length > 3 ? "…" : ""})` : ""}`);
    if (found.every((s) => !s.models.length)) warn("The local AI server has no model yet", found[0].protocol === "ollama" ? "Run: ollama pull llama3.2" : "Load a model in the server");
  } else {
    warn("No local AI server found (optional: it keeps your chats on this computer)", "Install Ollama (https://ollama.com/download), then: ollama pull llama3.2");
  }

  // Local voice
  const voice = require("../server/voice");
  if (voice.installed()) ok("Local voice is set up (listening and speaking offline)");
  else console.log(`${paint(2, "·")} Local voice: not set up (optional, ~1 GB). Talking to a local AI needs it: npm run voice:setup`);

  // Desktop app
  const electron = path.join(root, "node_modules", "electron", "dist", "electron");
  if (fs.existsSync(electron)) ok("Electron is ready for the desktop app (npm run desktop / npm run dist)");
  else console.log(`${paint(2, "·")} Desktop app: not set up (optional). Run: npm ci && node node_modules/electron/install.js`);

  console.log(`\n${errors ? paint(31, `${errors} problem${errors === 1 ? "" : "s"} to fix`) : paint(32, "Ready.")}${warnings ? paint(33, `  ${warnings} tip${warnings === 1 ? "" : "s"}`) : ""}`);
  process.exit(errors ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
