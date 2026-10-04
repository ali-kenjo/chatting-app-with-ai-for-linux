// Backups of your data folder: chats, memory notes, settings, brains (never
// their keys) and everything else you keep in Friends, as one gzipped JSON file
// in <data folder>/backups/. Made by themselves once a day (Settings → Data),
// when you ask, and before every restore, so a restore can be undone.
//
// A backup holds the files as they are, so it keeps working when new kinds of
// data are added: everything in the data folder is included except what's
// listed in SKIP (keys, caches, the speech models, the backups themselves).
// Attachments and your own robot model are included only when asked (Export
// with files), since they can be large and never change once saved.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { dataDir, version } = require("./config");
const logger = require("./logger");

const dir = path.join(dataDir, "backups");
const FORMAT = "friends-backup";
const NAME = /^friends-[0-9TZ-]+-(auto|manual|before-restore|import)\.json\.gz$/;
// Never in a backup: API keys, the desktop window's browser cache, the speech
// models (~1 GB, downloaded again by the setup), the backups, half-written files
const SKIP = [/^secrets\.json$/, /^desktop(\/|$)/, /^voice(\/|$)/, /^backups(\/|$)/, /\.tmp$/, /(^|\/)\.health-probe$/];
// Only with files: true
const LARGE = [/^attachments\//, /^robot\//];
// What a path inside a backup may look like (nothing outside the data folder)
const SAFE_PATH = /^[\w][\w.-]*(\/[\w][\w.-]*){0,3}$/;
const MAX_FILE = 40 * 1024 * 1024;
const KEEP_BEFORE_RESTORE = 5;

const skipped = (rel) => SKIP.some((re) => re.test(rel));
const large = (rel) => LARGE.some((re) => re.test(rel));

// Modules that keep data in memory (settings, brains…) reload after a restore
const restoreHooks = new Set();
const onRestore = (fn) => restoreHooks.add(fn);

function walk(base, rel = "", out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (skipped(child)) continue;
    if (entry.isDirectory()) walk(base, child, out);
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

// The data folder as a backup object. files: also attachments and the robot model.
function snapshot({ files = false } = {}) {
  const list = [];
  for (const rel of walk(dataDir)) {
    if (!files && large(rel)) continue;
    const full = path.join(dataDir, rel);
    let data;
    try {
      const stat = fs.statSync(full);
      if (stat.size > MAX_FILE) continue;
      data = fs.readFileSync(full);
    } catch {
      continue;
    }
    const text = /\.(json|md|txt)$/.test(rel);
    list.push({ path: rel, encoding: text ? "utf8" : "base64", data: data.toString(text ? "utf8" : "base64") });
  }
  return { format: FORMAT, version: 1, app: version, createdAt: new Date().toISOString(), withFiles: files, files: list };
}

const pack = (backup) => zlib.gzipSync(JSON.stringify(backup), { level: 6 });

// A backup file's bytes (gzipped or plain JSON) → the checked backup object
function unpack(buffer) {
  let text;
  try {
    text = (buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer, { maxOutputLength: 1024 * 1024 * 1024 }) : buffer).toString("utf8");
  } catch {
    throw new Error("That file isn't a Friends backup (it can't be unpacked).");
  }
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Friends backup (it isn't valid JSON).");
  }
  if (backup?.format !== FORMAT || !Array.isArray(backup.files)) throw new Error("That file isn't a Friends backup.");
  for (const f of backup.files) {
    if (typeof f?.path !== "string" || !SAFE_PATH.test(f.path) || f.path.split("/").includes("..") || skipped(f.path)) {
      throw new Error(`The backup has a file that can't be restored safely (${String(f?.path).slice(0, 80)}).`);
    }
    if (!["utf8", "base64"].includes(f.encoding) || typeof f.data !== "string") throw new Error(`The backup's copy of ${f.path} is damaged.`);
  }
  return backup;
}

const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");

function fileOf(name) {
  if (typeof name !== "string" || !NAME.test(name)) throw new Error("Backup not found.");
  return path.join(dir, name);
}

function describe(name) {
  const stat = fs.statSync(path.join(dir, name));
  return { name, kind: name.match(NAME)[1], size: stat.size, createdAt: stat.mtimeMs };
}

function list() {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => NAME.test(n));
  } catch {}
  return names
    .map((n) => {
      try {
        return describe(n);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

// Keeps the newest `keep` automatic backups and a few made before restores; yours stay
function prune(keep) {
  const all = list();
  const drop = [...all.filter((b) => b.kind === "auto").slice(keep), ...all.filter((b) => b.kind === "before-restore").slice(KEEP_BEFORE_RESTORE)];
  for (const b of drop) fs.rmSync(path.join(dir, b.name), { force: true });
}

// Saves a backup in the backups folder. kind: auto | manual | before-restore | import
function create(kind = "manual", { files = false, keep } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let name = `friends-${stamp()}-${kind}.json.gz`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `friends-${stamp()}-${n}-${kind}.json.gz`;
  const tmp = path.join(dir, name + ".tmp");
  fs.writeFileSync(tmp, pack(snapshot({ files })), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, name));
  if (keep) prune(keep);
  return describe(name);
}

const exportBuffer = ({ files = false } = {}) => pack(snapshot({ files }));

function read(name) {
  return fs.readFileSync(fileOf(name));
}

function remove(name) {
  fs.rmSync(fileOf(name), { force: true });
  return { ok: true };
}

// Puts a backup's files back. mode "replace": the data folder becomes what the
// backup holds (chats made since are removed); "merge": what's here stays, and
// the backup's files are added or written over. A backup of the current state
// is made first, so either can be undone.
function restore(buffer, { mode = "replace" } = {}) {
  const backup = unpack(buffer);
  if (!["replace", "merge"].includes(mode)) throw new Error('Restore mode is "replace" or "merge".');
  const safety = create("before-restore", { files: backup.withFiles === true });

  if (mode === "replace") {
    const incoming = new Set(backup.files.map((f) => f.path));
    for (const rel of walk(dataDir)) {
      if (!backup.withFiles && large(rel)) continue; // a backup without files leaves yours alone
      if (!incoming.has(rel)) fs.rmSync(path.join(dataDir, rel), { force: true });
    }
  }
  for (const f of backup.files) {
    const full = path.join(dataDir, f.path);
    fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
    const tmp = full + ".tmp";
    fs.writeFileSync(tmp, Buffer.from(f.data, f.encoding), { mode: 0o600 });
    fs.renameSync(tmp, full);
  }
  for (const fn of restoreHooks) {
    try {
      fn();
    } catch (err) {
      logger.warn("Reloading after a restore failed:", err.message);
    }
  }
  return { ok: true, mode, files: backup.files.length, from: backup.createdAt, safety: safety.name };
}

function restoreSaved(name, options) {
  return restore(read(name), options);
}

// Once a day, in the background (Settings → Data → Automatic backups)
const DAY = 24 * 60 * 60 * 1000;
let timer = null;
let firstTimer = null;

function due(now = Date.now()) {
  const last = list().find((b) => b.kind === "auto");
  return !last || now - last.createdAt > DAY - 60 * 60 * 1000;
}

function tick(getSettings) {
  try {
    const s = getSettings().backup;
    if (!s?.auto || !due()) return null;
    // Nothing worth keeping yet (a fresh install)
    if (!walk(dataDir).some((rel) => rel !== "settings.json")) return null;
    const made = create("auto", { keep: s.keep });
    logger.info(`Backed up your data: ${made.name}`);
    return made;
  } catch (err) {
    logger.warn("The automatic backup failed:", err.message);
    return null;
  }
}

function schedule(getSettings, { firstDelay = 60 * 1000, every = 60 * 60 * 1000 } = {}) {
  clearInterval(timer);
  clearTimeout(firstTimer);
  firstTimer = setTimeout(() => tick(getSettings), firstDelay);
  firstTimer.unref?.();
  timer = setInterval(() => tick(getSettings), every);
  timer.unref?.();
}

module.exports = { dir, create, list, read, remove, restore, restoreSaved, exportBuffer, snapshot, unpack, prune, tick, due, schedule, onRestore, NAME };
