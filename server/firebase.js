// The Firebase web config for "Sign in with Google" (Gmail, Calendar, Drive).
// It's yours: create a free Firebase project, copy its web app config here
// (Settings → Connected Apps), and add localhost and 127.0.0.1 under Firebase
// console → Authentication → Settings → Authorized domains. The config is kept in
// <data folder>/firebase-applet-config.json; one next to the app still works.
// (A Firebase web config identifies your project; it isn't a secret key.)
const fs = require("fs");
const path = require("path");
const { dataDir, writeJson } = require("./config");

const KEYS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId"];
const file = () => path.join(dataDir, "firebase-applet-config.json");
const beside = path.join(__dirname, "..", "firebase-applet-config.json");

// Takes what the Firebase console shows (a JS snippet "const firebaseConfig = { apiKey: "…", … }")
// or plain JSON. Returns the clean config; throws what's missing.
function parse(text) {
  let found = {};
  if (text && typeof text === "object") found = text;
  else {
    const source = String(text || "").trim();
    try {
      found = JSON.parse(source);
    } catch {
      for (const [, key, value] of source.matchAll(/["']?(\w+)["']?\s*:\s*["']([^"']*)["']/g)) if (KEYS.includes(key)) found[key] = value;
    }
  }
  const config = {};
  for (const key of KEYS) if (typeof found[key] === "string" && found[key].trim()) config[key] = found[key].trim();
  const missing = ["apiKey", "projectId", "appId"].filter((k) => !config[k]);
  if (missing.length) throw new Error(`That doesn't look like a Firebase web config: ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} missing. In the Firebase console open Project settings → Your apps → Web app, and copy the whole config.`);
  if (!/^AIza[\w-]{30,}$/.test(config.apiKey)) throw new Error("The apiKey doesn't look right. Copy it again from the Firebase console.");
  config.authDomain ||= `${config.projectId}.firebaseapp.com`;
  return config;
}

function read() {
  for (const candidate of [file(), beside]) {
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch {}
  }
  return null;
}

const save = (text) => {
  const config = parse(text);
  writeJson(file(), config);
  return config;
};

const remove = () => fs.rmSync(file(), { force: true });

module.exports = { parse, read, save, remove, file };
