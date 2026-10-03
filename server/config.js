// Where Friends keeps its data, runtime configuration, and safe storage primitives.
const fs = require("fs");
const os = require("os");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "package.json");
let version = "0.1.0";
try {
  version = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || version;
} catch {}

const port = Number(process.env.PORT) || 3000;
// Only this computer can reach Friends. Set HOST=0.0.0.0 (e.g. in Docker) to open it up.
const host = process.env.HOST || "127.0.0.1";

const dataDir =
  process.env.FRIENDS_DATA_DIR ||
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "friends");

// Write to a temp file first so a crash can't leave a half-written file.
// Files are readable only by the owner (mode 0600, dir 0700).
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function checkStorage() {
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const probe = path.join(dataDir, ".health-probe");
    fs.writeFileSync(probe, "ok", { mode: 0o600 });
    fs.unlinkSync(probe);
    return { ok: true, path: dataDir };
  } catch (err) {
    return { ok: false, path: dataDir, error: err.message };
  }
}

module.exports = {
  version,
  port,
  host,
  dataDir,
  writeJson,
  checkStorage,
};
