// API key management with multi-tier storage:
// 1. Desktop system keyring (GNOME Keyring / KWallet via Secret Service)
// 2. Headless/container secure local file fallback (~/.config/friends/secrets.json, mode 0600)
// 3. Environment variable fallback (GEMINI_API_KEY)
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");
const logger = require("./logger");

let keyringAvailable = null;
let Entry = null;
try {
  ({ Entry } = require("@napi-rs/keyring"));
} catch {
  Entry = null;
}

const SERVICE = "friends";
const secretsFile = path.join(dataDir, "secrets.json");

function entry(id) {
  if (!Entry) return null;
  return new Entry(SERVICE, `brain-${id}`);
}

function loadFileSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsFile, "utf8"));
  } catch {
    return {};
  }
}

function saveFileSecrets(secrets) {
  writeJson(secretsFile, secrets);
}

function isSystemKeyringOperational() {
  if (keyringAvailable !== null) return keyringAvailable;
  const backend = (process.env.KEYRING_BACKEND || "auto").toLowerCase();
  if (backend === "file") {
    keyringAvailable = false;
    return false;
  }
  if (!Entry) {
    keyringAvailable = false;
    return false;
  }
  try {
    const probe = new Entry(SERVICE, "health-probe-key");
    probe.setPassword("probe");
    probe.deletePassword();
    keyringAvailable = true;
  } catch (err) {
    logger.debug("System keyring unavailable, using secure file store fallback:", err.message);
    keyringAvailable = false;
  }
  return keyringAvailable;
}

function setKey(id, key) {
  if (isSystemKeyringOperational()) {
    try {
      entry(id).setPassword(key);
      return;
    } catch (err) {
      logger.warn(`Failed to save to system keyring, falling back to secure file store: ${err.message}`);
    }
  }

  // File store fallback (mode 0600)
  const secrets = loadFileSecrets();
  secrets[String(id)] = key;
  saveFileSecrets(secrets);
}

// The key of a brain that may have none (local AI servers). Never falls back to
// GEMINI_API_KEY: that key must not be sent to anything but Google.
function getOptionalKey(id) {
  let key = null;
  if (isSystemKeyringOperational()) {
    try {
      key = entry(id)?.getPassword();
    } catch {}
  }
  return key || loadFileSecrets()[String(id)] || "";
}

function getKey(id) {
  let key = null;

  // 1. Check system keyring
  if (isSystemKeyringOperational()) {
    try {
      key = entry(id)?.getPassword();
    } catch {}
  }

  // 2. Check local file store fallback
  if (!key) {
    const secrets = loadFileSecrets();
    key = secrets[String(id)] || null;
  }

  // 3. Check environment variable fallback
  if (!key && process.env.GEMINI_API_KEY) {
    key = process.env.GEMINI_API_KEY;
  }

  if (!key) {
    throw new Error("This brain's API key is missing from your keyring. Enter it again in Settings → AI control.");
  }
  return key;
}

function deleteKey(id) {
  if (isSystemKeyringOperational()) {
    try {
      entry(id)?.deletePassword();
    } catch {}
  }

  try {
    const secrets = loadFileSecrets();
    if (secrets[String(id)]) {
      delete secrets[String(id)];
      saveFileSecrets(secrets);
    }
  } catch {}
}

module.exports = { setKey, getKey, getOptionalKey, deleteKey, isSystemKeyringOperational };
